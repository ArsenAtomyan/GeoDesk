# GeoDesk

**GeoDesk** is a single-file, browser-based mapping application for organizing, filtering, and visualizing geographic data — built entirely with vanilla HTML, CSS, and JavaScript on top of the Yandex Maps JS API.

🔗 **Live demo:** [arsenatomyan.github.io/GeoDesk](https://arsenatomyan.github.io/GeoDesk/)

---

## Overview
Totally Vibecoded (claude only)

GeoDesk turns a list of locations into an interactive map workspace. Import data by pasting CSV, organize it into layers, filter it down with multi-select checkboxes and weekday toggles, search and browse it in an A–Z indexed sidebar, draw custom shapes directly on the map, and build routes to any point — all from a single `index.html` file with no backend, build step, or dependencies to install.

The UI is fully responsive: a fixed sidebar with tabs on desktop, and a swipeable bottom sheet with a mobile tab bar on phones.

## Features

### 🗂️ Layers
Toggle visibility of individual data layers from the sidebar, independent of any active filters.

### 🔍 Filter
Narrow down what's shown on the map using:
- Dropdown selects for category-style fields
- Multi-select checkbox lists
- Weekday toggles (e.g. for filtering locations open on specific days)
- Apply / reset actions

### 📍 Locations
- Live search bar with a result counter
- A–Z jump navigation to browse long lists quickly
- Alphabetically grouped feature list with color-coded status dots and tags (e.g. open/closed, active/passive/lost)
- Clicking an item highlights the matching marker and opens its map balloon (name, details, weekday availability, website link)

### 📥 Import
Paste CSV data directly into the app to add locations, with an in-app reference for the expected column format.

### ✏️ Draw
A built-in drawing toolbar for adding custom shapes to the map:
- Multiple drawing tools (points, lines, polygons, etc.) in a quick-access grid
- Adjustable stroke color and width
- A list of drawn shapes with inline rename, restyle, and delete
- Floating toolbar that appears on the map while actively drawing

### 🧭 Route
Build a route to a selected point directly from the sidebar, with status feedback (success/error) shown inline.

### 📌 My Location
A floating GPS button for centering the map on — and tracking — the user's current location.

### 📱 Mobile-first responsive design
Below 640px, the sidebar collapses into a draggable bottom sheet, tabs move into a bottom navigation bar, and modals become full-width bottom sheets — so the app is just as usable on a phone as on desktop.

## Getting Started

No build tools or dependencies required.

```bash
git clone https://github.com/ArsenAtomyan/GeoDesk.git
cd GeoDesk
```

Then either:
- Open `index.html` directly in your browser, or
- Serve the folder with any static server (recommended, to avoid local file/CORS quirks), e.g.:

```bash
npx serve .
```

## Tech Stack

- **HTML/CSS/JS** — no framework, single self-contained file
- **Yandex Maps JavaScript API** — interactive map rendering, markers, and balloons
- **Google Fonts** — DM Sans (UI) and DM Mono (labels/data)

## Project Structure

```
GeoDesk/
├── index.html   # the entire application (markup, styles, and logic)
└── README.md
```

## Browser Support

Works in modern evergreen browsers (Chrome, Edge, Firefox, Safari). The responsive layout targets both desktop and mobile viewports (breakpoint at 640px).

## License

No license file is currently included. If you plan to share or open-source this project, consider adding one (MIT is a common choice for projects like this).
