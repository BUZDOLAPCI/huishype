# HuisHype — Social Real Estate Map & Valuation Platform

**Domains:** huishype.nl / huishype.com

## Other agent rules:

This current document and these documents are the source of truth for design/implementation decisions:
./agent-rules/software-stack.md
./agent-rules/test-requirements.md

## Overview

This product is a **social-first real estate exploration and valuation platform**. It aggregates public housing listings and addresses into a map- and feed-based experience where users can **interact with properties socially**: guessing fair prices, commenting, reacting, and tracking interest over time.

The core premise is simple:

> People already browse housing apps like funda obsessively, form opinions, guess prices, and discuss them privately. This app turns that behavior into a **shared, social,  gamified and data-generating experience**.

The platform is **not a marketplace** and does not replace listing sites. Instead, it acts as a **social and analytical layer on top of existing real estate markets**, forwarding traffic to original listings while generating unique crowd-based insights.\
\
A listing is not a main requirement, any address can be interacted with. But naturally we should expect listings getting more interest and design accordingly to steer towards.

---

## Core Goals

- Make housing exploration **engaging, social, and opinionated** rather than static and transactional
- Capture **crowd-estimated fair market value (FMV)** through price-guessing mechanics
- Surface **interest, sentiment, and controversy** around individual properties and neighborhoods
- Build a long-term **data moat** around price perception, attention, and user credibility
- Serve both casual browsers and serious buyers/renters without fragmenting the experience

---

## Core Concepts

### 1. Property as a Social Object

Each **address / listing** is treated as a persistent social entity with:

- A public activity history
- Ongoing discussion
- Crowd price perception
- Interest metrics over time

Properties accumulate context beyond a single listing lifecycle.

---

### 2. Crowd-Based Price Guessing (Fair Market Value)

Users can submit **one price guess** per property, representing what they personally believe the property is worth.

**Guess Editing:** Users may update their guess with a **5-day cooldown** between edits.

Key characteristics:

- Guesses are not averaged blindly
- Each user has a **credibility / karma score**
- Higher-credibility users have higher influence on FMV
- Wildly inaccurate guesses reduce future influence

**FMV Integrity Rules (Anti-Manipulation):**

To prevent gaming and ensure meaningful FMV calculations:

- **Cold Start:** FMV is anchored closer to WOZ value and shown as "low confidence" until at least **3 guesses** are submitted
- **Outlier Trimming:** Use a robust estimator (median-ish behavior) to reduce impact of extreme values
- **New Account Weight:** Fresh accounts have minimal influence on FMV until they have verified outcomes (prevents Sybil attacks)
- **Meme Guess Filtering:** Extreme outliers (e.g., "1" / "10M", drastically different from WOZ value) are flagged and excluded from FMV calculation

The result is a continuously evolving **crowd-estimated FMV**, shown as:

- A weighted value
- A distribution curve (range, confidence)
- Comparison to asking price if exists

This mechanism is central to engagement and data generation.

---

### 3. Social Commentary Layer

Each property has a **short-form comment feed**, inspired by TikTok / Instagram Reels comments:

- Fast, opinionated, informal
- Chronological with lightweight reactions (likes, reacts)
- default sorting like tiktok, newer popular comments on top
- Users can reply to 'base' comments to further discussion, consecutive replies should only mention replied user. 1 level deep replies, like tiktok, youtube etc.

Comments may include:

- Price opinions
- Neighborhood insights
- Lived experiences
- Photo skepticism
- Emotional reactions ("this is insane", "actually decent for the area")

The platform intentionally encourages **authentic, non-agent discourse**.

---

### 4. Interest & Attention Signals

Beyond price, the platform tracks **attention**:

- Views
- Unique viewers
- Comments
- Price guesses
- Saves / follows

These signals are visualized as:

- Interest meters per property
- Trending listings
- Heatmaps by area
- Velocity indicators (interest rising or fading)

This reveals **demand dynamics** before transactions occur.

---

## Primary User Experiences

### Access & Authentication

Login via google or apple account

**View-only without login, interactions gated at submit:**
- Browsing the map, viewing listings, reading comments fully accessible without login
- Users can **start** a guess or comment without being logged in
- Login is required only at the **submit** moment (reduces friction, captures intent)
- **"Save property"** acts as the first conversion moment (requires login)

This approach captures user intent before requiring authentication.

---

### Map View

Main view. A social Snap-style map focused on housing activity:

- Properties shown as interactive points
- Should group points/nodes depending on zoom level like housing apps
- Each address can be interacted with
- it defaults to *interesting content*, not raw density. think map + feed hybrid in feel


- **Ghost Nodes:** Show all for-sale listings (via BAG data + "For Sale" indicator) as small, low-opacity dots. This proves the platform has data.
- **Active Nodes:** Show "Socially Active" properties (recent comments, guesses, high interest) as slightly larger, pulsing, colored. This guides attention to engaging content.

The contrast between ghost and active nodes creates visual proof of coverage while highlighting where the fun is.

**Visual activity indicators:**
- Pulses indicating recent activity (comments, guesses, upvotes)
- Filters by price range, size, interest, sentiment

The map prioritizes **what is interesting**, not just what exists.

---

### Map Interaction Pattern: Object-on-Map + Quick Actions + Bottom Sheet

The map interaction follows a **lightweight, playful, in-context pattern** that keeps users on the map rather than yanking them to separate pages.

#### On-Tap Property Preview (Instant Preview)

When a user taps a property on the map:

1. **Instant Preview Card** appears directly on the map near the property:
   - Small photo thumbnail (if listing exists and current viewport isn't cluttered)
   - Address snippet
   - Current FMV or asking price (if available)
   - Quick visual indicator of activity level (hot/warm/cold)

2. **Quick Action Buttons** displayed prominently on the preview card:
   - **Like/Upvote** - Single tap to express interest
   - **Comment** - Opens the full bottom-sheet scrolls to comment section and intializes a new comment input
   - **Guess** - Opens the full bottom-sheet scrolls to price guess slider section

   Like should feel as fast as double-tapping on Instagram.

3. **Preview Intelligence:**
   - Show photo preview on nodes in viewport when property is "interesting enough" (has listing, recent activity, trending) compared to rest of the viewport nodes
   - Hide photos when viewport is cluttered (many properties visible) to avoid visual noise

#### Bottom Sheet for Extended UI

Tapping the preview card (or a "More" arrow button) slides up a **bottom sheet** containing:

- Full property photos (if available)
- Funda / Pararius / other listing links (tap to open externally)
- Complete address and metadata
- WOZ value comparison
- Price guess slider UI
- Full FMV visualization with distribution curve
- Comment feed (scrollable)
- Activity timeline
- "Save" and "Share" and "Add to Favorite" actions

**Bottom Sheet Behavior:**
- Partial expand (half screen) shows key info + quick actions
- Full expand (swipe up) reveals complete detail view
- Swipe down to dismiss and return to map
- Map remains visible and interactive at partial expand state

#### Design Principles

- **Never leave the map unnecessarily** - All quick interactions happen in-context
- **Progressive disclosure** - Simple preview → Quick actions → Full detail sheet
- **Lightweight and playful** - Feels like social media, not a mortgage application
- **Fast feedback** - Actions complete instantly with optimistic UI updates

---

### Feed View

A content-style feed showing:

- Newly active listings
- Highly interacted properties
- Price mismatches (asking vs FMV)
- Polarizing listings

This makes housing browsing feel closer to a social app than a classifieds site.

---

### Property Detail View

Each property page includes:

- Basic metadata (address, size, asking price)
- **WOZ value** (official government valuation as baseline "price anchor")
- Link(s) to original listing(s)
- Price guess interface (guess requires minimal friction (e.g. swipe slider))
- FMV visualization
- Comment feed
- Interest metrics
- Historical activity (when available)

The page acts as the **social memory of an address**.

For what information we can put here or what photos we can fetch, take a look at [https://woningstats.nl/](https://woningstats.nl/) it is a single-dev website that aggregates freely available data. It has satellite photo for each address. Huispeadia also has a auto-photo for no photo addresses, looks like they pull them from streetview photos like this one [https://huispedia.nl/eindhoven/5651hp/deflectiespoelstraat/16](https://huispedia.nl/eindhoven/5651hp/deflectiespoelstraat/16)\
^this url structure is also nice for addresses

---

### User Profiles

Users have lightweight public profiles showing:

- Guess accuracy history
- Karma / credibility score, starts from 0, doesn't go below 0, but keep negative internal metric in case we need to ban repetitive offending users with wildly intentionally inaccurate guesses
- Areas of activity
- Badges or achievement\
  &#x20;

Profiles emphasize **reputation**. They can set single profile photo, have a username handle that can't be changed, and a name that they can change once every 30 days

---

## HuisHype Plus (Premium Subscription)

### Overview

HuisHype Plus is a **subscription-driven cosmetic feature** that feels fun and map-native. It allows users to place a personalized **Virtual House marker** on the map to highlight a property they choose.

Inspired by "virtual home" cosmetics from Snap Maps, but adapted to HuisHype's real-estate context.

### Virtual House Cosmetic Marker

The Virtual House is a **3D cosmetic house model** that appears on the map at a user's chosen location. It's purely aesthetic and social — a way for users to express themselves and claim a "home" on the map.

**Key Characteristics:**
- Visually distinct from regular property markers (3D rendered, animated, eye-catching)
- Does not affect property data, FMV, or any platform mechanics
- Visible to other users browsing the map
- Can be placed on any address (doesn't need to be a listing)

### Entry Point & User Flow

**Profile → "My Hype House"**

1. **Select a House Location:**
   - User navigates to the map
   - Searches or browses to find their desired address
   - Taps to select the property as their "Hype House" location

2. **Choose a House Design:**
   - User is presented with available 3D cosmetic house models
   - Designs range from classic Dutch rowhouses to modern villas to playful/quirky options
   - Preview how each design looks on the map before confirming

3. **Place & Customize:**
   - Confirm placement
   - Optional: Add a short tagline or status visible to visitors
   - House appears on the map for all users to see

### Available House Designs (Initial Set)

Design categories to consider:
- **Classic Dutch** - Traditional grachtenpand, rijtjeshuis, boerderij
- **Modern** - Minimalist cube, glass house, penthouse
- **Playful** - Treehouse, houseboat, tiny house, castle
- **Seasonal/Limited** - Holiday themes, special event editions (limited availability)

New designs can be added over time as rewards, seasonal drops, or premium add-ons.

### Pricing Model

**HuisHype Plus Subscription Includes:**
- **1 Personal Virtual House slot** - Place one Virtual House marker on the map
- **Access to standard house designs** - Core collection of cosmetic models
- **Profile badge** - "HuisHype Plus" indicator on user profile

**Optional Add-ons (Additional Fee):**
- **Extra Virtual House slots** - Place additional markers (2nd house, vacation home, additional agent listing etc.)
- **Premium/Exclusive designs** - Special 3D models not in the base collection

### Social & Map Integration
- Virtual Houses appear as distinct markers when other users browse the map, but otherwise same as other nodes


---

## Data Sources & Aggregation

### Data Hierarchy (Legally Safe Foundation)

**Base Layer (Safe - BAG Data):**
- Seed the database with **BAG (Basisregistratie Adressen en Gebouwen)** - official Dutch government open data
- Every building in the Netherlands exists here legally
- This provides a valid node for every address immediately, regardless of whether it is for sale
- No legal risk - this is public government data

**WOZ Value Integration:**
- Integrate public **WOZ-waarde** (official government property valuation) as the baseline "price anchor"
- Shown before user guesses to provide context
- Public data, no scraping required

**User-Submitted Listings:**
- Users paste Funda/Pararius/other listing URLs to "unlock" discussion for a property
- System fetches **Open Graph metadata** (title/thumbnail) just like WhatsApp or Slack link previews
- Shifts legal liability toward user-generated content
- Encourages user participation and ownership

**Internal Listing Discovery (Separate Service):**
- This capability is **out of scope for the main application**
- The listing discovery/scraping system should be a separate microservice with its own repo: `/home/caslan/dev/git_repos/hh/huishype-funda-scraper`
- This separation keeps scraping complexity (IP bans, CAPTCHAs, maintenance) from polluting the main application context
- The main app consumes discovered listings via API, but does not implement discovery logic
- just write the necessary spec md files to huishype-funda-scraper folder so we can implement it later.

### What the Platform Extracts

- Address (from BAG)
- WOZ value (from public records)
- Asking price (from user-submitted or discovered listings)
- Size / type
- Listing URL
- Open Graph metadata (thumbnail, title) from listing links

Key principles:

- Original listings are always linked
- The platform does not replace or replicate full listings
- Users may submit listings manually
- BAG data provides the foundation, listings are an overlay

### Visual Fallback Strategy for Property Photos

Every property node should display a photo. The fallback hierarchy is:

1. **Listing Photos** — If a listing exists and has photos, use listing thumbnail (via Open Graph)
2. **User-Submitted Photos** — Community-contributed property images
3. **Street View API** — For any house without photos, fetch Google Street View image as worst-case fallback
   - This ensures every address can show a visual representation
   - Street View coverage in Netherlands is comprehensive

This guarantees visual content for all properties, whether listings or just "interesting" nodes.

The product positions itself as a **discussion and analytics layer**, not a broker or marketplace.

---

## Gamification & Credibility System

### Karma / Credibility

Each user has a dynamic credibility score influenced by:

- Accuracy of past price guesses (when sale price becomes known)
- Consistency over time
- Avoidance of extreme outliers

Credibility affects:

- Influence on FMV
- Visibility or weight of guesses

This discourages trolling and incentivizes thoughtful participation. Also shown in comments section beside their name as certain rank title depending on their points to make them feel worthy

---

### Intermediate Rewards (Faster Feedback Loop)

- **Consensus Alignment Feedback:** Show users immediately if their guess aligns with crowd consensus (e.g., "You agree with 90% of top predictors"). This provides a small dopamine hit without revealing right/wrong prematurely. It also provokes users with outlier positions to comment and defend their view.

---

### Long-Term Resolution

When a property is sold or rented:

- The final price is recorded (when available)
- User guesses are evaluated retroactively
- Credibility is adjusted

Delayed feedback is intentional and central to retention.

---

## Key Use Cases

### Casual Browsing

- Explore neighborhoods
- React to outrageous prices
- Comment, reply to comment and guess for fun

### Serious Buyers / Renters

- Gauge real interest
- Identify overpriced listings
- Track competition signals

### Market Observers

- Spot trends
- Monitor attention shifts
- Compare crowd FMV vs asking prices

### Future B2B / Analytics (Non-core)

- Aggregated interest data
- Market perception reports
- Demand heatmaps

---

## Non-Goals

- Acting as a real estate broker
- Handling transactions
- Replacing listing platforms
- Providing official valuations

The product is **opinionated, social, and exploratory by design**.

---

## What Makes This Defensible

- Unique crowd-generated FMV data
- Historical perception of individual addresses
- User credibility graph
- Attention and sentiment signals unavailable elsewhere
- BAG-based foundation (legally unassailable)
- WOZ integration for credible baseline pricing

These are difficult to replicate without a social-first product.

---

## Guiding Principles

- Social before transactional
- Opinionated over neutral
- Engagement over efficiency
- Long-term data over short-term monetization
- Transparency over authority

---

## UX Principles: What Makes This Product Special

### 1. Core Idea Validation

At its heart, this product **turns housing listings into social content and prediction markets**.

This works especially well because housing is:

- **Emotional** – people react strongly to prices and locations
- **High-stakes** – buying or renting is one of the biggest life decisions
- **Slow-moving** – listings stay around long enough to build anticipation
- **Opaque** – true value is unclear and contested

These characteristics make housing uniquely suitable for **speculation, opinions, and social signaling**.

Users already:

- Guess prices mentally
- Send listings to friends ("this is insane", "this would go for 900k easy")
- Argue about value and fairness

The product simply **formalizes and amplifies existing behavior** instead of inventing new habits.

---

### 2. What's Genuinely Novel

##### A. Price guessing as a mechanic

This is not just a gimmick — it creates:

- **engagement loop**: guess → follow → wait → resolve
- **long-term retention**: houses sell slowly → delayed reward
- **signal quality**: weighted guesses over time = powerful data

If done right, this becomes:

- *"Fantasy football for real estate"*

The **karma / reputation weighting** idea is crucial. Without it, it turns into noise.

This mechanic enables valuable data:

1. a **crowd-estimated FMV**
2. with **credibility scores**



---

#### B. Social Layer on Individual Addresses

Social interaction is anchored to **places**, not just listings.

Think:

- TikTok comments, but for a specific address
- A long-term memory for a property:
  - "sold 2021 for X"
  - "always mold issues"
  - "sunlight is fake, photos lie"
  - "neighborhood changed a lot"

This creates **anti-broker, lived-experience information**, which users strongly trust and value.

---

#### C. Interest & Attention Visualization

The platform does not just show supply; it shows **attention**.

Examples:

- Heatmaps of interest
- "Most commented this week"
- "Most polarizing listings"
- "Overpriced according to the crowd"

Attention data reveals demand dynamics that traditional listing platforms do not surface.

---

### 3. Lightweight, Playful Interaction Model

The UX follows an **"object-on-map + quick actions + bottom sheet"** pattern:

- **Object-on-Map:** Properties are interactive objects on the map, not list items
- **Quick Actions:** Comment/Like/Guess buttons appear on tap — fast, fun, low friction
- **Bottom Sheet:** Extended UI (links, full details, comments) slides up without leaving the map

This keeps the experience:
- **In-context** — users stay oriented on the map
- **Lightweight** — no page navigation for simple actions
- **Playful** — feels like a social app, not a real estate portal

**Instant Preview** further supports this:
- See the house in-context on the map
- Small photo preview when interesting (has listing) and viewport isn't cluttered
- Progressive disclosure: preview → actions → full detail

---

### 4. Listings Aggregation & Legal Reality

Aggregation is a critical capability but also the largest risk.

**Legal Context (Netherlands):**
NVM (the realtor association behind Funda) is notoriously litigious regarding data scraping. Even positioning as a "discussion layer," bulk scraping of photos or structural data can trigger Cease & Desists.

**Mitigation Strategy:**

The BAG-first data hierarchy (described above) provides legal protection:
- Base layer is government open data (BAG)
- WOZ values are public
- User-submitted links are user-generated content
- Open Graph metadata fetching is standard practice (like WhatsApp/Slack)



What is generally survivable:

- Ingesting **minimal metadata** (address, asking price, size)
- Showing **one thumbnail** (via Open Graph)
- **Deep-linking clearly** to original listings
- Positioning as a **discussion and analytics layer**

The safest framing is:

> **"A social analytics overlay for public housing listings."**

Even safer:

- Allow users to submit listing links
- Auto-extract Open Graph metadata
- Rely heavily on user-generated content

This positioning protects the platform while reinforcing its core value proposition.

---

## Localization & Country Specificity

The platform launches **Netherlands-first**, reflecting high housing pressure, strong engagement with platforms like Funda, and a culture of open price discussion. The Dutch market is used as a **real-world proving ground**, not a long-term constraint.

**Netherlands-Specific Data Sources:**
- **BAG** (Basisregistratie Adressen en Gebouwen) - building/address registry
- **WOZ-waarde** - official government property valuations
- **PDOK** - government geographic data services

Aside from **local data ingestion (listing sources, scrapers, sale-price resolution)**, all core product systems are designed to be **fully market-agnostic**: social interactions, price guessing, FMV modeling, credibility, feeds, and map UX.

**What to keep in mind while developing:**
- Never hard-code country- or platform-specific assumptions
- Separate *property identity* (address + geo) from *market listings* (source-specific)
- Treat localization as a pluggable adapter (data, currency, norms)
- Ensure adding a new country requires data integration, not product redesign

The long-term goal is for **HuisHype** to become a **globally reusable social real estate layer**, validated first in the Netherlands.

---

## Summary

**HuisHype** turns housing from a static, opaque marketplace into a **living, fun, social system**. By combining maps, comments, and price prediction mechanics, it captures how people actually think and feel about real estate — and converts that into insights that do not exist today.

