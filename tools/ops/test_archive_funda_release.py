"""Local Git fixture tests; no network, builds, or production operations."""
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import tarfile
import tempfile
import unittest

SPEC = importlib.util.spec_from_file_location("archive_funda", Path(__file__).with_name("archive-funda-release.py"))
archive_funda = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(archive_funda)


class ArchiveTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / "source"
        self.root.mkdir()
        self.child = self.root / "pyfunda"
        self.child.mkdir()
        for repo in [self.root, self.child]:
            self.git(repo, "init", "-q")
            self.git(repo, "config", "user.name", "Archive Test")
            self.git(repo, "config", "user.email", "archive-test@example.invalid")
        (self.child / "pyfunda.py").write_text("pinned child\n")
        self.git(self.child, "add", "pyfunda.py")
        self.git(self.child, "-c", "commit.gpgsign=false", "commit", "-qm", "pin")
        self.pin = self.git(self.child, "rev-parse", "HEAD")
        (self.root / "scraper").mkdir()
        (self.root / "scraper" / "runtime.py").write_text("committed runtime\n")
        self.git(self.root, "add", "scraper/runtime.py")
        self.git(self.root, "update-index", "--add", "--cacheinfo", "160000," + self.pin + ",pyfunda")
        self.git(self.root, "-c", "commit.gpgsign=false", "commit", "-qm", "source")
        self.revision = self.git(self.root, "rev-parse", "HEAD")

    def git(self, repo, *args):
        return subprocess.run(["git", "-C", str(repo), *args], check=True, capture_output=True, text=True).stdout.strip()

    def test_exact_commits_exclude_dirty_untracked_and_newer_submodule_head(self):
        (self.root / "scraper" / "runtime.py").write_text("dirty runtime\n")
        (self.root / ".env.production").write_text("secret\n")
        (self.root / "untracked-plan.md").write_text("untracked plan\n")
        (self.child / "pyfunda.py").write_text("newer child head\n")
        self.git(self.child, "add", "pyfunda.py")
        self.git(self.child, "-c", "commit.gpgsign=false", "commit", "-qm", "newer unpinned child")
        (self.child / "pyfunda.py").write_text("dirty child\n")
        (self.child / ".env").write_text("child secret\n")
        before = self.git(self.root, "status", "--porcelain")
        payload, manifest = archive_funda.committed_archive(self.root, self.revision)
        with tarfile.open(fileobj=io.BytesIO(payload), mode="r:gz") as archive:
            names = archive.getnames()
            self.assertEqual(archive.extractfile("scraper/runtime.py").read(), b"committed runtime\n")
            self.assertEqual(archive.extractfile("pyfunda/pyfunda.py").read(), b"pinned child\n")
            self.assertFalse({".env.production", "untracked-plan.md", "pyfunda/.env"}.intersection(names))
            self.assertEqual(manifest["memberCount"], len(names))
        self.assertEqual(manifest["sourceSHA"], self.revision)
        self.assertEqual(manifest["submoduleSHA"], self.pin)
        self.assertEqual(self.git(self.root, "status", "--porcelain"), before)
        self.assertEqual((self.root / "scraper/runtime.py").read_text(), "dirty runtime\n")

    def test_archive_is_deterministic_and_outputs_private_manifest(self):
        first, details = archive_funda.committed_archive(self.root, self.revision)
        second, second_details = archive_funda.committed_archive(self.root, self.revision)
        self.assertEqual(first, second)
        self.assertEqual(details, second_details)
        output = Path(self.temp.name) / "private"
        archive, manifest, written = archive_funda.write_release(self.root, self.revision, output)
        self.assertEqual(archive.read_bytes(), first)
        self.assertEqual(written["archiveSHA256"], hashlib.sha256(first).hexdigest())
        self.assertEqual(written["bytes"], len(first))
        self.assertEqual(json.loads(manifest.read_text()), written)
        self.assertEqual(output.stat().st_mode & 0o777, 0o700)
        self.assertEqual(archive.stat().st_mode & 0o777, 0o600)
        self.assertEqual(manifest.stat().st_mode & 0o777, 0o600)
        with self.assertRaises(FileExistsError):
            archive_funda.write_release(self.root, self.revision, output)
        self.assertEqual(archive.read_bytes(), first)

    def test_rejects_noncommit_or_abbreviated_revision_and_missing_child_repository(self):
        for revision in [self.revision[:7], "0" * 40, "HEAD"]:
            with self.assertRaises(ValueError):
                archive_funda.committed_archive(self.root, revision)
        self.child.rename(self.root / "child-moved")
        self.child.mkdir()
        with self.assertRaisesRegex(ValueError, "worktree_root"):
            archive_funda.committed_archive(self.root, self.revision)

    def test_rejects_unsafe_member_paths(self):
        for name in ["/outside", "../outside", "a/../outside", "a//b", "C:/outside", "a\\b", "line\nbreak"]:
            with self.assertRaises(ValueError):
                archive_funda.validate_members([tarfile.TarInfo(name)])

    def test_validates_symlink_chains_without_extracting(self):
        def link(name, target):
            member = tarfile.TarInfo(name)
            member.type, member.linkname = tarfile.SYMTYPE, target
            return member
        archive_funda.validate_members([link("scraper/alias", "../pyfunda/pyfunda.py")])
        for members in [[link("escape", "/outside")], [link("escape", "../outside")],
                        [link("x", "."), link("y", "x/../outside")],
                        [link("x", "y"), link("y", "x")],
                        [link("dir", "elsewhere"), tarfile.TarInfo("dir/file")]]:
            with self.assertRaises(ValueError):
                archive_funda.validate_members(members)
        hardlink = tarfile.TarInfo("hard")
        hardlink.type, hardlink.linkname = tarfile.LNKTYPE, "../outside"
        with self.assertRaises(ValueError):
            archive_funda.validate_members([hardlink])


if __name__ == "__main__":
    unittest.main()
