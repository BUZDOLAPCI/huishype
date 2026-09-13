#!/usr/bin/env python3
"""Archive an exact Funda commit and its pinned pyfunda gitlink, entirely locally.

python3 tools/ops/archive-funda-release.py --repository /path/to/funda-hybrid \
  --revision <full40SHA> --output-dir /private/release-archive

Only committed Git objects are read. Worktree changes and untracked files are
excluded. Output directories use 0700, files use 0600. Existing output files
are never overwritten. No checkout, build, upload, or network operation occurs.
"""

import argparse
import gzip
import hashlib
import io
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tarfile


def git(repository, *arguments):
    result = subprocess.run(["git", "-C", str(repository), *arguments], capture_output=True, check=False)
    if result.returncode:
        raise ValueError("git_command_failed")
    return result.stdout


def checked_commit(repository, revision):
    if not isinstance(revision, str) or not re.fullmatch(r"[0-9a-f]{40}", revision):
        raise ValueError("revision_requires_full_lowercase_40_hex_sha")
    root = Path(git(repository, "rev-parse", "--show-toplevel").decode().strip()).resolve()
    if root != Path(repository).resolve():
        raise ValueError("repository_must_be_git_worktree_root")
    resolved = git(repository, "rev-parse", "--verify", revision + "^{commit}").decode().strip()
    if resolved != revision:
        raise ValueError("revision_must_identify_exact_commit")
    return revision


def safe_name(name):
    if (not name or name.startswith("/") or "\\" in name or re.match(r"^[A-Za-z]:", name)
            or any(ord(char) < 32 for char in name)
            or any(part in ("", ".", "..") for part in name.rstrip("/").split("/"))):
        raise ValueError("unsafe_archive_member_path")
    return name.rstrip("/")


def validate_members(members):
    names, links = {}, {}
    for member in members:
        name = safe_name(member.name)
        if name in names:
            raise ValueError("duplicate_archive_member")
        if not (member.isfile() or member.isdir() or member.issym()):
            raise ValueError("unsupported_archive_member_type")
        names[name] = member
        if member.issym():
            target = member.linkname
            if (not target or target.startswith("/") or "\\" in target
                    or re.match(r"^[A-Za-z]:", target) or any(ord(char) < 32 for char in target)):
                raise ValueError("unsafe_archive_symlink")
            links[name] = target
    for name in names:
        parts = name.split("/")
        for index in range(1, len(parts)):
            ancestor = names.get("/".join(parts[:index]))
            if ancestor is not None and not ancestor.isdir():
                raise ValueError("archive_member_has_non_directory_ancestor")
    # Resolve symlink chains virtually, including '..' after another symlink.
    # A lexical normpath alone misses escapes such as x->'.', y->'x/../outside'.
    for name, target in links.items():
        resolved, pending, expansions = name.split("/")[:-1], target.split("/"), 0
        while pending:
            part = pending.pop(0)
            if part in ("", "."):
                continue
            if part == "..":
                if not resolved:
                    raise ValueError("archive_symlink_escapes_root")
                resolved.pop()
                continue
            resolved.append(part)
            nested = links.get("/".join(resolved))
            if nested is not None:
                expansions += 1
                if expansions > 40:
                    raise ValueError("archive_symlink_cycle")
                resolved.pop()
                pending = nested.split("/") + pending


def committed_archive(repository, revision):
    repository = Path(repository).resolve()
    checked_commit(repository, revision)
    tree = git(repository, "ls-tree", "-z", revision, "--", "pyfunda")
    metadata, separator, path = tree.rstrip(b"\0").partition(b"\t")
    fields = metadata.decode().split()
    if not separator or path != b"pyfunda" or len(fields) != 3 or fields[:2] != ["160000", "commit"]:
        raise ValueError("pyfunda_must_be_pinned_gitlink")
    pin = checked_commit(repository / "pyfunda", fields[2])
    entries = {}
    for repo, commit, prefix in [(repository, revision, ""), (repository / "pyfunda", pin, "pyfunda/")]:
        data = git(repo, "archive", "--format=tar", "--prefix=" + prefix, commit)
        with tarfile.open(fileobj=io.BytesIO(data), mode="r:") as archive:
            for member in archive.getmembers():
                name = safe_name(member.name)
                if name in entries:
                    if member.isdir() and entries[name][0].isdir():
                        continue
                    raise ValueError("duplicate_committed_path")
                content = archive.extractfile(member).read() if member.isfile() else None
                # Normalize tar/PAX metadata and ordering for reproducible bytes.
                item = tarfile.TarInfo(name)
                item.type, item.mode, item.linkname = member.type, member.mode, member.linkname
                item.size = len(content) if content is not None else 0
                item.uid = item.gid = item.mtime = 0
                entries[name] = (item, content)
    ordered = [entries[name] for name in sorted(entries)]
    validate_members([item for item, _ in ordered])
    buffer = io.BytesIO()
    with gzip.GzipFile(filename="", mode="wb", fileobj=buffer, mtime=0) as compressed:
        with tarfile.open(fileobj=compressed, mode="w", format=tarfile.PAX_FORMAT) as archive:
            for item, content in ordered:
                archive.addfile(item, io.BytesIO(content) if content is not None else None)
    payload = buffer.getvalue()
    with tarfile.open(fileobj=io.BytesIO(payload), mode="r:gz") as archive:
        validate_members(archive.getmembers())
    return payload, {"sourceSHA": revision, "submoduleSHA": pin, "archiveSHA256": hashlib.sha256(payload).hexdigest(),
                     "bytes": len(payload), "memberCount": len(ordered)}


def write_release(repository, revision, output_dir):
    payload, manifest = committed_archive(repository, revision)
    output = Path(output_dir)
    output.mkdir(mode=0o700, parents=True, exist_ok=True)
    output.chmod(0o700)
    archive_path = output / ("funda-source-" + revision + ".tar.gz")
    manifest_path = output / ("funda-source-" + revision + ".manifest.json")
    # Reserve both outputs first, so a pre-existing artifact is never clobbered.
    archive_fd = os.open(archive_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    try:
        manifest_fd = os.open(manifest_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    except Exception:
        os.close(archive_fd)
        archive_path.unlink()
        raise
    try:
        with os.fdopen(archive_fd, "wb") as archive_handle, os.fdopen(manifest_fd, "w") as manifest_handle:
            archive_handle.write(payload)
            json.dump(manifest, manifest_handle, indent=2, sort_keys=True)
            manifest_handle.write("\n")
    except Exception:
        archive_path.unlink(missing_ok=True)
        manifest_path.unlink(missing_ok=True)
        raise
    return archive_path, manifest_path, manifest


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--repository", required=True)
    parser.add_argument("--revision", required=True)
    parser.add_argument("--output-dir", required=True)
    args = parser.parse_args(argv)
    try:
        archive, manifest, details = write_release(args.repository, args.revision, args.output_dir)
        print(json.dumps({"archive": str(archive), "manifest": str(manifest), **details}, sort_keys=True))
        return 0
    except Exception as exc:
        # Git stderr and filesystem error paths can contain operator secrets.
        error = str(exc) if type(exc) is ValueError else type(exc).__name__
        print(json.dumps({"error": error}), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
