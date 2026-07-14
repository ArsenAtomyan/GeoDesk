    // ─── CONSTANTS ───────────────────────────────────────────────
    const DAYS = { W1:'Mon', W2:'Tue', W3:'Wed', W4:'Thu', W5:'Fri', W6:'Sat', W7:'Sun' };
    const COLOR_MAP = {
        red:'#e74c3c', blue:'#3498db', green:'#27ae60', yellow:'#f1c40f',
        orange:'#e67e22', purple:'#9b59b6', pink:'#e91e8c', black:'#222',
        white:'#ddd', gray:'#95a5a6'
    };

    // ─── STATE ───────────────────────────────────────────────────
    let map;
    let layers = [];
    let currentLayer = null;
    let currentFilters = { status:[], color:[], car:[], driver:[], owner:[], days:[] };
    let searchQuery = '';
    let activeTab = 'locations';
    let userLocationMarker = null;

    // ─── DOM REFS ────────────────────────────────────────────────
    const $ = id => document.getElementById(id);
    const el = {
        layerList: $('layer-list'),
        featureList: $('feature-list'),
        searchInput: $('search-input'),
        countShown: $('count-shown'),
        countTotal: $('count-total'),
        alphaNav: $('alpha-nav'),
        filterStatusList: $('filter-status-list'),
        filterColorList: $('filter-color-list'),
        filterCarList: $('filter-car-list'),
        filterDriverList: $('filter-driver-list'),
        filterOwnerList: $('filter-owner-list'),
        weekdayToggles: document.querySelectorAll('.day-toggle'),
        pasteArea: $('paste-area'),
        modalOverlay: $('modal-overlay'),
        modalBody: $('modal-body'),
    };

    // ─── INIT ────────────────────────────────────────────────────
    ymaps.ready(initMap);

    function initMap() {
        map = new ymaps.Map('map', {
            center: [40.1811, 44.5136],
            zoom: 12,
            controls: ['zoomControl', 'typeSelector', 'fullscreenControl']
        });

        // Tabs
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
                document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
                btn.classList.add('active');
                $(`${btn.dataset.tab}-panel`).classList.add('active');
                activeTab = btn.dataset.tab;
            });
        });

        // File buttons
        $('open-geojson').onclick = () => $('file-input').click();
        $('open-kml').onclick = () => $('kml-input').click();
        $('open-csv').onclick = () => $('csv-input').click();
        $('close-layer').onclick = closeCurrentLayer;
        $('file-input').onchange = importGeoJSON;
        $('kml-input').onchange = importKML;
        $('csv-input').onchange = importCSV;

        // Filters — auto-apply on checkbox change (set up in populateDynamicFilters)
        $('clear-filter').onclick = clearFilters;
        el.weekdayToggles.forEach(t => t.onclick = () => {
            t.classList.toggle('on');
            const day = t.dataset.day;
            if (t.classList.contains('on')) {
                if (!currentFilters.days.includes(day)) currentFilters.days.push(day);
            } else {
                currentFilters.days = currentFilters.days.filter(d => d !== day);
            }
            applyFilters();
        });

        // Search
        el.searchInput.addEventListener('input', e => {
            searchQuery = e.target.value.toLowerCase().trim();
            renderFeatureList();
        });

        // Mark all / unmark all (Locations tab)
        $('mark-all-btn').onclick = markAllVisible;
        $('unmark-all-btn').onclick = unmarkAll;

        // My Location
        $('my-location-btn').onclick = showMyLocation;

        // Paste import
        $('parse-paste').onclick = () => {
            const raw = el.pasteArea.value.trim();
            if (!raw) return;
            parseCSVText(raw, 'Pasted Data');
            el.pasteArea.value = '';
        };

        // Quick load: fetch a .csv / .geojson / .json file sitting next to this page
        $('quickload-btn').onclick = quickLoadFromFolder;
        $('quickload-filename').addEventListener('keydown', e => {
            if (e.key === 'Enter') quickLoadFromFolder();
        });

        // Modal
        $('modal-close').onclick = () => el.modalOverlay.classList.remove('open');
        el.modalOverlay.onclick = e => { if (e.target === el.modalOverlay) el.modalOverlay.classList.remove('open'); };

        // Route buttons
        const routeStatus = $('route-status');

        function buildYandexRouteUrl(startPoint, features) {
            // startPoint is either "lat,lon" string or an address string
            const stops = [startPoint, ...features.map(f => {
                const [lon, lat] = f.geometry.coordinates;
                return `${lat},${lon}`;
            })].join('~');
            return `https://yandex.com/maps/?rtext=${encodeURIComponent(stops).replace(/%7E/g,'~')}&rtt=auto`;
        }

        function getFilteredCoords() {
            if (!currentLayer || currentLayer.isRoute) return null;
            const filtered = getFilteredFeatures().filter(f =>
                f.geometry && f.geometry.type === 'Point' && f.geometry.coordinates?.length >= 2
            );
            // If any locations are marked, route through the marked ones only — in the
            // order they were marked, so the user controls the stop sequence — while
            // still respecting the active search/filters.
            if (currentLayer.markedIds && currentLayer.markedIds.size > 0) {
                const filteredIds = new Set(filtered.map(f => f.properties.id));
                const marked = [...currentLayer.markedIds]
                    .filter(id => filteredIds.has(id))
                    .map(id => filtered.find(f => f.properties.id === id))
                    .filter(Boolean);
                return marked.length ? marked : null;
            }
            return filtered.length ? filtered : null;
        }

        function doRoute(action, startPoint) {
            const features = getFilteredCoords();
            if (!features) {
                routeStatus.className = 'route-status error';
                routeStatus.textContent = 'No valid coordinates in filtered results.';
                return;
            }
            const url = buildYandexRouteUrl(startPoint, features);
            if (action === 'open') {
                window.open(url, '_blank');
                routeStatus.className = 'route-status success';
                routeStatus.textContent = `Opened route with ${features.length} stop(s).`;
            } else {
                navigator.clipboard.writeText(url).then(() => {
                    routeStatus.className = 'route-status success';
                    routeStatus.textContent = `Link copied! (${features.length} stop(s))`;
                }).catch(() => {
                    routeStatus.className = 'route-status error';
                    routeStatus.textContent = 'Could not copy to clipboard.';
                });
            }
        }

        function buildRouteWithGeolocation(action) {
            const manualStart = $('route-start-input').value.trim();
            if (manualStart) {
                doRoute(action, manualStart);
                return;
            }
            routeStatus.className = 'route-status';
            routeStatus.textContent = 'Getting your location…';
            navigator.geolocation.getCurrentPosition(
                pos => doRoute(action, `${pos.coords.latitude},${pos.coords.longitude}`),
                () => {
                    routeStatus.className = 'route-status error';
                    routeStatus.textContent = 'Location blocked. Enter a start address above.';
                },
                { timeout: 8000 }
            );
        }

        $('open-route-btn').onclick = () => buildRouteWithGeolocation('open');
        $('copy-route-btn').onclick = () => buildRouteWithGeolocation('copy');

        // Init drawing tools
        initDrawing();

        // Build alpha nav
        buildAlphaNav();
    }

    // ─── DRAWING SYSTEM ──────────────────────────────────────────
    let drawingMode  = null;
    let drawColor    = '#c84b2f';
    let drawStrokeW  = 3;
    let drawFillOpacity = 0.4;
    let drawLabel    = '';
    let drawPoints   = [];
    let circleCenter = null;
    let drawCollection;
    let tempPreview  = null;   // committed-points polyline
    let tempCircle   = null;   // circle ghost (recreated each frame)
    let tempRect     = null;   // rect ghost (recreated each frame)
    let tempSegment  = null;   // cursor→last-point segment
    let drawnShapes  = [];
    let editingShapeId = null;

    const DRAW_HINTS = {
        pointer:    '',
        move:       'Drag any shape to reposition it. Click elsewhere when done.',
        marker:     'Click on the map to place a marker.',
        line:       'Left-click to add points.  Right-click to finish.',
        polygon:    'Left-click to add points.  Right-click to close shape.',
        circle:     'Click to set the center point.',
        circle2:    'Move mouse to set radius — click to confirm.',
        rectangle:  'Click the first corner.',
        rectangle2: 'Move mouse to set size — click to confirm.',
    };
    const SHAPE_ICONS = { marker:'📍', line:'╱', polygon:'⬡', circle:'○', rectangle:'▭', move:'✥' };

    // ── Init ────────────────────────────────────────────────────
    function initDrawing() {
        drawCollection = new ymaps.GeoObjectCollection();
        map.geoObjects.add(drawCollection);

        document.querySelectorAll('.draw-tool-btn').forEach(btn =>
            btn.addEventListener('click', () => setDrawTool(btn.dataset.tool))
        );
        $('draw-color').addEventListener('input',   e => { drawColor = e.target.value; });
        $('draw-width').addEventListener('input',   e => { drawStrokeW = +e.target.value; $('draw-width-val').textContent = e.target.value+'px'; });
        $('draw-opacity').addEventListener('input', e => { drawFillOpacity = +e.target.value/100; $('draw-opacity-val').textContent = e.target.value+'%'; });
        $('draw-label').addEventListener('input',   e => { drawLabel = e.target.value; });

        $('draw-exit-btn').addEventListener('click',          () => setDrawTool('pointer'));
        $('clear-drawings').addEventListener('click',         clearAllDrawings);
        $('export-drawings').addEventListener('click',        exportDrawings);
        $('import-drawings-btn').addEventListener('click',    () => $('import-drawings-input').click());
        $('import-drawings-input').addEventListener('change', importDrawings);

        // left-click  → place points / confirm shapes
        map.events.add('click',       onMapClick);
        // right-click → finish line / polygon
        map.events.add('contextmenu', onMapRightClick);
        // mouse move  → live ghost previews
        map.events.add('mousemove',   onMapMouseMove);
    }

    // ── Tool switching ──────────────────────────────────────────
    function setDrawTool(tool) {
        // leave move mode cleanly
        if (drawingMode === 'move') leaveMoveMode();

        cancelCurrentDraw();
        drawingMode = (tool === 'pointer') ? null : tool;

        document.querySelectorAll('.draw-tool-btn').forEach(b =>
            b.classList.toggle('active', b.dataset.tool === tool)
        );

        const mapEl    = map.container.getElement();
        const hintEl   = $('draw-hint');
        const floatBar = $('draw-floating-bar');

        if (drawingMode) {
            floatBar.classList.add('active');
            $('draw-active-label').textContent = `✏️ ${tool.charAt(0).toUpperCase()+tool.slice(1)}`;
            hintEl.textContent = DRAW_HINTS[tool] || '';
            hintEl.classList.add('visible');

            if (drawingMode === 'move') {
                mapEl.style.cursor = 'grab';
                enterMoveMode();
            } else {
                mapEl.style.cursor = 'crosshair';
                // Make data-layer pins AND all drawn shapes click-transparent
                // so map click events always reach our handlers
                layers.forEach(l => l.geoObjects.options.set('interactivityModel','default#transparent'));
                drawCollection.options.set('interactivityModel','default#transparent');
            }
        } else {
            mapEl.style.cursor = '';
            floatBar.classList.remove('active');
            hintEl.classList.remove('visible');
            // Restore normal interactivity
            layers.forEach(l => l.geoObjects.options.unset('interactivityModel'));
            drawCollection.options.unset('interactivityModel');
        }
    }

    // ── Move mode ────────────────────────────────────────────────
    function enterMoveMode() {
        drawnShapes.forEach(s => {
            if (!s.geoObject || s.visible === false) return;
            s.geoObject.options.set('draggable', true);
            s.geoObject.events.add('dragend', () => snapshotShapeCoords(s));
        });
    }
    function leaveMoveMode() {
        drawnShapes.forEach(s => {
            if (!s.geoObject) return;
            snapshotShapeCoords(s);
            s.geoObject.options.set('draggable', false);
            s.geoObject.events.remove('dragend');
        });
    }
    function snapshotShapeCoords(shape) {
        try {
            const g = shape.geoObject.geometry;
            if      (shape.type === 'marker')    shape.points = [g.getCoordinates()];
            else if (shape.type === 'line')      shape.points = g.getCoordinates();
            else if (shape.type === 'polygon')   shape.points = g.getCoordinates()[0];
            else if (shape.type === 'circle')  { shape.points = [g.getCoordinates()]; shape.radius = g.getRadius(); }
            else if (shape.type === 'rectangle') shape.points = g.getBounds();
        } catch(e) {}
    }

    // ── Mouse move — ghost previews ──────────────────────────────
    function onMapMouseMove(e) {
        if (!drawingMode || drawingMode === 'move' || drawingMode === 'marker') return;
        const coords = e.get('coords');

        // CIRCLE: destroy+recreate each frame (most reliable across Yandex Maps versions;
        // setRadius silently fails on shrink in 2.1)
        if (drawingMode === 'circle' && circleCenter) {
            const dist = haversine(circleCenter, coords);
            if (tempCircle) { try { drawCollection.remove(tempCircle); } catch(_){} }
            tempCircle = new ymaps.Circle([circleCenter, dist], {}, {
                strokeColor: drawColor, strokeWidth: drawStrokeW,
                strokeOpacity: 0.6, strokeStyle: 'dash',
                fillColor: drawColor, fillOpacity: drawFillOpacity * 0.4,
                interactivityModel: 'default#transparent'
            });
            drawCollection.add(tempCircle);
            return;
        }

        // RECTANGLE: same destroy+recreate approach
        if (drawingMode === 'rectangle' && drawPoints.length === 1) {
            if (tempRect) { try { drawCollection.remove(tempRect); } catch(_){} }
            tempRect = new ymaps.Rectangle([drawPoints[0], coords], {}, {
                strokeColor: drawColor, strokeWidth: drawStrokeW,
                strokeOpacity: 0.6, strokeStyle: 'dash',
                fillColor: drawColor, fillOpacity: drawFillOpacity * 0.4,
                interactivityModel: 'default#transparent'
            });
            drawCollection.add(tempRect);
            return;
        }

        // LINE / POLYGON: live segment from last committed point to cursor
        if ((drawingMode === 'line' || drawingMode === 'polygon') && drawPoints.length >= 1) {
            const last = drawPoints[drawPoints.length - 1];
            // For polygon also show closing edge back to first point
            const segPts = (drawingMode === 'polygon' && drawPoints.length >= 2)
                ? [last, coords, drawPoints[0]]
                : [last, coords];

            if (tempSegment) {
                // Try in-place update; if it throws recreate
                try { tempSegment.geometry.setCoordinates(segPts); return; } catch(_) {
                    try { drawCollection.remove(tempSegment); } catch(__){} tempSegment = null;
                }
            }
            tempSegment = new ymaps.Polyline(segPts, {}, {
                strokeColor: drawColor, strokeWidth: drawStrokeW,
                strokeOpacity: 0.5, strokeStyle: 'dash',
                interactivityModel: 'default#transparent'
            });
            drawCollection.add(tempSegment);
        }
    }

    // haversine distance in metres — avoids ymaps.coordSystem call which
    // can fail when the API is still loading or when called from preview code
    function haversine(a, b) {
        const R = 6371000, rad = Math.PI/180;
        const dLat = (b[0]-a[0])*rad, dLon = (b[1]-a[1])*rad;
        const x = Math.sin(dLat/2)**2 + Math.cos(a[0]*rad)*Math.cos(b[0]*rad)*Math.sin(dLon/2)**2;
        return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1-x));
    }

    // ── Left-click — place points / confirm ─────────────────────
    function onMapClick(e) {
        if (!drawingMode || drawingMode === 'move') return;
        const coords = e.get('coords');

        if (drawingMode === 'marker') {
            finishShape('marker', [coords]);

        } else if (drawingMode === 'line' || drawingMode === 'polygon') {
            drawPoints.push(coords);
            updatePolyPreview();

        } else if (drawingMode === 'circle') {
            if (!circleCenter) {
                circleCenter = coords;
                $('draw-hint').textContent = DRAW_HINTS['circle2'];
            } else {
                const dist = haversine(circleCenter, coords);
                clearCirclePreview();
                finishShape('circle', [circleCenter], dist);
                circleCenter = null;
                $('draw-hint').textContent = DRAW_HINTS['circle'];
            }

        } else if (drawingMode === 'rectangle') {
            drawPoints.push(coords);
            if (drawPoints.length === 1) {
                $('draw-hint').textContent = DRAW_HINTS['rectangle2'];
            } else {
                clearRectPreview();
                finishShape('rectangle', [drawPoints[0], drawPoints[1]]);
                $('draw-hint').textContent = DRAW_HINTS['rectangle'];
            }
        }
    }

    // ── Right-click — finish line / polygon ──────────────────────
    function onMapRightClick(e) {
        if (!drawingMode) return;
        if (drawingMode !== 'line' && drawingMode !== 'polygon') return;
        e.preventDefault();   // suppress browser context menu
        if (drawingMode === 'line'    && drawPoints.length >= 2) finishShape('line',    [...drawPoints]);
        if (drawingMode === 'polygon' && drawPoints.length >= 3) finishShape('polygon', [...drawPoints]);
        drawPoints = [];
        clearPolyPreview();
    }

    // ── Preview helpers ──────────────────────────────────────────
    function updatePolyPreview() {
        if (tempPreview) { try { drawCollection.remove(tempPreview); } catch(_){} tempPreview = null; }
        if (drawPoints.length < 2) return;
        const pts = (drawingMode === 'polygon') ? [...drawPoints, drawPoints[0]] : [...drawPoints];
        tempPreview = new ymaps.Polyline(pts, {}, {
            strokeColor: drawColor, strokeWidth: drawStrokeW,
            strokeOpacity: 0.7, strokeStyle: 'dash',
            interactivityModel: 'default#transparent'
        });
        drawCollection.add(tempPreview);
    }

    function clearPolyPreview() {
        if (tempPreview) { try { drawCollection.remove(tempPreview); } catch(_){} tempPreview = null; }
        if (tempSegment) { try { drawCollection.remove(tempSegment); } catch(_){} tempSegment = null; }
    }
    function clearCirclePreview() {
        if (tempCircle)  { try { drawCollection.remove(tempCircle);  } catch(_){} tempCircle  = null; }
    }
    function clearRectPreview() {
        if (tempRect)    { try { drawCollection.remove(tempRect);    } catch(_){} tempRect    = null; }
    }
    function cancelCurrentDraw() {
        clearPolyPreview(); clearCirclePreview(); clearRectPreview();
        drawPoints = []; circleCenter = null;
    }

    // ── Build final geoObject from shape record ──────────────────
    function buildGeoObject(shape) {
        const so = { strokeColor: shape.color, strokeWidth: shape.strokeW, strokeOpacity: 0.9 };
        const fo = { ...so, fillColor: shape.color, fillOpacity: shape.fillOpacity };
        if (shape.type === 'marker') {
            return new ymaps.Placemark(shape.points[0],
                { hintContent: shape.name, balloonContent: shape.name },
                { iconLayout:'default#image', iconImageHref: createDotIcon(shape.color),
                  iconImageSize:[22,22], iconImageOffset:[-11,-11] }
            );
        }
        if (shape.type === 'line')      return new ymaps.Polyline(shape.points, { hintContent: shape.name }, so);
        if (shape.type === 'polygon')   return new ymaps.Polygon([shape.points], { hintContent: shape.name }, fo);
        if (shape.type === 'circle')    return new ymaps.Circle([shape.points[0], shape.radius], { hintContent: shape.name }, fo);
        if (shape.type === 'rectangle') return new ymaps.Rectangle(shape.points, { hintContent: shape.name }, fo);
        return null;
    }

    function finishShape(type, points, radius) {
        cancelCurrentDraw();
        const autoName = `${type.charAt(0).toUpperCase()+type.slice(1)} ${drawnShapes.length+1}`;
        const shape = {
            id: Date.now(), type,
            name: drawLabel.trim() || autoName,
            color: drawColor, strokeW: drawStrokeW, fillOpacity: drawFillOpacity,
            points, radius: radius || null,
            visible: true, geoObject: null
        };
        try { shape.geoObject = buildGeoObject(shape); } catch(err) { console.error('finishShape:', err); return; }
        if (!shape.geoObject) return;
        drawCollection.add(shape.geoObject);
        drawnShapes.push(shape);
        renderDrawnShapes();
        $('draw-label').value = ''; drawLabel = '';
    }

    function createDotIcon(color) {
        const svg = `<svg width="22" height="22" xmlns="http://www.w3.org/2000/svg"><circle cx="11" cy="11" r="9" fill="${color}" stroke="white" stroke-width="2"/></svg>`;
        return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    }

    // ── Shapes list ──────────────────────────────────────────────
    function renderDrawnShapes() {
        const list = $('drawn-shapes-list');
        if (!drawnShapes.length) {
            list.innerHTML = '<div style="padding:8px 14px;font-size:12px;color:var(--text-3)">No shapes yet</div>';
            editingShapeId = null; return;
        }
        list.innerHTML = '';
        drawnShapes.forEach(shape => {
            const wrap = document.createElement('div');
            const hidden = shape.visible === false;

            // Row
            const item = document.createElement('div');
            item.className = 'drawn-shape-item';
            item.style.opacity = hidden ? '0.45' : '1';
            item.innerHTML = `
                <span style="width:10px;height:10px;background:${shape.color};border-radius:50%;display:inline-block;flex-shrink:0"></span>
                <span style="font-size:13px;flex-shrink:0">${SHAPE_ICONS[shape.type]||'?'}</span>
                <span class="drawn-shape-name">${shape.name}</span>
                <span class="drawn-shape-type">${shape.type}</span>
                <button class="drawn-shape-delete" data-a="vis"  title="${hidden?'Show':'Hide'}">${hidden?'🚫':'👁'}</button>
                <button class="drawn-shape-delete" data-a="edit" title="Edit" style="color:var(--blue)">✎</button>
                <button class="drawn-shape-delete" data-a="del"  title="Delete">✕</button>
            `;

            // Inline edit panel
            const ep = document.createElement('div');
            ep.className = 'shape-edit-panel';
            ep.style.display = (editingShapeId === shape.id) ? 'flex' : 'none';
            const noFill = shape.type === 'line' || shape.type === 'marker';
            ep.innerHTML = `
                <input type="text" class="ep-name" value="${shape.name}" placeholder="Name">
                <div class="shape-edit-row">
                    <label>Color</label>
                    <input type="color" class="ep-color" value="${shape.color}">
                </div>
                <div class="shape-edit-row">
                    <label>Stroke</label>
                    <input type="range" class="ep-stroke" min="1" max="10" value="${shape.strokeW}">
                    <span class="range-val ep-sw">${shape.strokeW}px</span>
                </div>
                <div class="shape-edit-row" ${noFill ? 'style="opacity:.35;pointer-events:none"' : ''}>
                    <label>Fill</label>
                    <input type="range" class="ep-opacity" min="0" max="100" step="5" value="${Math.round(shape.fillOpacity*100)}">
                    <span class="range-val ep-fo">${Math.round(shape.fillOpacity*100)}%</span>
                </div>
                <div class="shape-edit-actions">
                    <button class="btn primary ep-save">✓ Save</button>
                    <button class="btn ep-cancel">Cancel</button>
                </div>
            `;
            // Live preview: every edit updates the actual shape on the map immediately,
            // so the user sees the real result while dragging sliders / picking colors.
            // Nothing is "committed" until Save — Cancel (or navigating away) reverts
            // to the snapshot taken when editing started.
            const swatch = item.querySelector('span');
            const nameEl = item.querySelector('.drawn-shape-name');
            const livePreview = () => {
                updateShapeFromInputs(shape, ep);
                swatch.style.background = shape.color;
                nameEl.textContent = shape.name;
            };
            ep.querySelector('.ep-name').addEventListener('input', livePreview);
            ep.querySelector('.ep-color').addEventListener('input', livePreview);
            ep.querySelector('.ep-stroke').addEventListener('input', function(){ ep.querySelector('.ep-sw').textContent = this.value+'px'; livePreview(); });
            ep.querySelector('.ep-opacity').addEventListener('input', function(){ ep.querySelector('.ep-fo').textContent = this.value+'%'; livePreview(); });
            ep.querySelector('.ep-save').onclick   = () => saveShapeEdit(shape.id);
            ep.querySelector('.ep-cancel').onclick = () => cancelShapeEdit(shape.id);

            item.querySelector('[data-a="vis"]').onclick  = () => toggleVisible(shape.id);
            item.querySelector('[data-a="edit"]').onclick = () => {
                if (editingShapeId === shape.id) {
                    cancelShapeEdit(shape.id);           // closing without saving -> revert
                } else {
                    if (editingShapeId !== null) cancelShapeEdit(editingShapeId); // revert whichever was open
                    shape._snapshot = { name: shape.name, color: shape.color, strokeW: shape.strokeW, fillOpacity: shape.fillOpacity };
                    editingShapeId = shape.id;
                    renderDrawnShapes();
                }
            };
            item.querySelector('[data-a="del"]').onclick  = () => deleteShape(shape.id);

            wrap.appendChild(item);
            wrap.appendChild(ep);
            list.appendChild(wrap);
        });
    }

    function toggleVisible(id) {
        const s = drawnShapes.find(x => x.id === id);
        if (!s || !s.geoObject) return;
        s.visible = s.visible === false ? true : false;
        s.geoObject.options.set('visible', s.visible);
        renderDrawnShapes();
    }

    // Reads the edit-panel inputs into the shape record and rebuilds its geoObject.
    // Used both for the live preview (on every input event) and for the final Save.
    function updateShapeFromInputs(shape, ep) {
        shape.name        = ep.querySelector('.ep-name').value.trim() || shape.name;
        shape.color       = ep.querySelector('.ep-color').value;
        shape.strokeW     = +ep.querySelector('.ep-stroke').value;
        shape.fillOpacity = +ep.querySelector('.ep-opacity').value / 100;
        rebuildShapeGeoObject(shape);
    }

    function rebuildShapeGeoObject(shape) {
        try { if (shape.geoObject) drawCollection.remove(shape.geoObject); } catch(_) {}
        shape.geoObject = null;
        try { shape.geoObject = buildGeoObject(shape); } catch(err) { console.error('rebuildShapeGeoObject:', err); }
        if (shape.geoObject) {
            drawCollection.add(shape.geoObject);
            if (shape.visible === false) shape.geoObject.options.set('visible', false);
        }
    }

    function saveShapeEdit(id) {
        const shape = drawnShapes.find(s => s.id === id);
        if (!shape) return;
        delete shape._snapshot;
        editingShapeId = null;
        renderDrawnShapes();
    }

    function cancelShapeEdit(id) {
        const shape = drawnShapes.find(s => s.id === id);
        if (shape && shape._snapshot) {
            shape.name        = shape._snapshot.name;
            shape.color       = shape._snapshot.color;
            shape.strokeW     = shape._snapshot.strokeW;
            shape.fillOpacity = shape._snapshot.fillOpacity;
            rebuildShapeGeoObject(shape);
            delete shape._snapshot;
        }
        if (editingShapeId === id) editingShapeId = null;
        renderDrawnShapes();
    }

    function deleteShape(id) {
        const idx = drawnShapes.findIndex(s => s.id === id);
        if (idx < 0) return;
        try { drawCollection.remove(drawnShapes[idx].geoObject); } catch(_) {}
        if (editingShapeId === drawnShapes[idx].id) editingShapeId = null;
        drawnShapes.splice(idx, 1);
        renderDrawnShapes();
    }

    function clearAllDrawings() {
        if (!drawnShapes.length) return;
        if (!confirm(`Delete all ${drawnShapes.length} drawing(s)?`)) return;
        drawnShapes.forEach(s => { try { drawCollection.remove(s.geoObject); } catch(_){} });
        drawnShapes = []; editingShapeId = null;
        cancelCurrentDraw(); renderDrawnShapes();
    }

    // ── Export / Import ──────────────────────────────────────────
    function exportDrawings() {
        if (!drawnShapes.length) { alert('No drawings to export.'); return; }
        const data = drawnShapes.map(({ id,type,name,color,strokeW,fillOpacity,points,radius,visible }) =>
            ({ id,type,name,color,strokeW,fillOpacity,points,radius,visible })
        );
        const blob = new Blob([JSON.stringify(data,null,2)], { type:'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `geodesk-drawings-${new Date().toISOString().slice(0,10)}.json`;
        a.click(); URL.revokeObjectURL(a.href);
    }

    function importDrawings(e) {
        const file = e.target.files[0]; if (!file) return;
        e.target.value = '';
        const reader = new FileReader();
        reader.onload = ev => {
            let data;
            try { data = JSON.parse(ev.target.result); } catch { alert('Invalid drawings file.'); return; }
            importDrawingsFromData(data);
        };
        reader.readAsText(file);
    }

    // Shared by the file-picker import above and the same-folder quick-load below.
    function importDrawingsFromData(data) {
        if (!Array.isArray(data)) { alert('Invalid drawings file.'); return 0; }
        let loaded = 0;
        data.forEach(s => {
            try {
                const shape = {
                    id: Date.now()+Math.random(), type:s.type, name:s.name,
                    color:s.color, strokeW:s.strokeW??3, fillOpacity:s.fillOpacity??0.4,
                    points:s.points, radius:s.radius??null, visible:s.visible??true, geoObject:null
                };
                shape.geoObject = buildGeoObject(shape);
                if (shape.geoObject) {
                    if (!shape.visible) shape.geoObject.options.set('visible', false);
                    drawCollection.add(shape.geoObject);
                    drawnShapes.push(shape); loaded++;
                }
            } catch(err) { console.warn('Skipped:', err); }
        });
        renderDrawnShapes();
        alert(`Imported ${loaded} of ${data.length} shape(s).`);
        return loaded;
    }


    // ─── ALPHA NAV ────────────────────────────────────────────────
    function buildAlphaNav() {
        const letters = ['Ա','Բ','Գ','Դ','Ե','Զ','Է','Ը','Թ','Ժ','Ի','Լ','Խ','Ծ','Կ','Հ','Ձ','Ղ','Ճ','Մ','Յ','Ն','Շ','Ո','Չ','Պ','Ջ','Ռ','Ս','Վ','Տ','Ր','Ց','Ւ','Փ','Ք','Օ','Ֆ'];
        el.alphaNav.innerHTML = '';
        letters.forEach(l => {
            const btn = document.createElement('button');
            btn.className = 'alpha-btn';
            btn.textContent = l;
            btn.dataset.letter = l;
            btn.onclick = () => {
                const header = document.querySelector(`[data-alpha-header="${l}"]`);
                if (!header) return;
                // Note: don't use header.scrollIntoView() here — the group headers are
                // position:sticky, and native scrollIntoView miscalculates the target
                // offset when jumping to a header ABOVE the current scroll position
                // (it works fine going down, but silently fails/undershoots going up).
                // Computing the offset against the scroll container directly is reliable
                // in both directions.
                const container = el.featureList;
                const containerRect = container.getBoundingClientRect();
                const headerRect = header.getBoundingClientRect();
                const targetTop = container.scrollTop + (headerRect.top - containerRect.top);
                container.scrollTo({ top: targetTop, behavior: 'smooth' });
            };
            el.alphaNav.appendChild(btn);
        });
    }

    function updateAlphaHighlights(visibleFeatures) {
        const activeLetters = new Set(visibleFeatures.map(f => {
            const name = (f.properties.name || '').toUpperCase();
            return name[0] || '';
        }));
        document.querySelectorAll('.alpha-btn').forEach(btn => {
            // Match uppercase Armenian (U+0531–U+0556) or the '#' fallback
            const l = btn.dataset.letter;
            btn.classList.toggle('has-items', activeLetters.has(l));
        });
    }

    // ─── LAYER MANAGEMENT ────────────────────────────────────────
    function addLayer(data, name, isRoute = false) {
        const layer = {
            id: Date.now(),
            name: name || `Layer ${layers.length + 1}`,
            visible: true,
            isRoute,
            features: isRoute ? [] : (data.features || []),
            geoObjects: new ymaps.GeoObjectCollection(),
            routeInfo: null,
            markedIds: new Set()   // locations marked in the Locations tab (see toggleMark)
        };

        if (isRoute) {
            const path = new ymaps.Polyline(data, { hintContent: name }, {
                strokeColor: '#c84b2f', strokeWidth: 4, strokeOpacity: 0.8
            });
            layer.geoObjects.add(path);
            if (data.length > 0) {
                layer.routeInfo = { points: data.length, startPoint: data[0], endPoint: data[data.length - 1] };
                layer.geoObjects.add(new ymaps.Placemark(data[0], { hintContent: 'Start' }, { preset: 'islands#greenDotIcon' }));
                layer.geoObjects.add(new ymaps.Placemark(data[data.length - 1], { hintContent: 'End' }, { preset: 'islands#redDotIcon' }));
            }
        } else {
            layer.features.forEach(feature => {
                const props = feature.properties;
                const iconColor = COLOR_MAP[props.color?.toLowerCase()] || '#c84b2f';
                const iconUrl = createTriangleIcon(iconColor);
                const coords = parseCoords(props.coordinates || (feature.geometry?.coordinates ? `${feature.geometry.coordinates[1]}, ${feature.geometry.coordinates[0]}` : ''));
                if (!coords) return;

                const placemark = new ymaps.Placemark(
                    coords,
                    { ...props, balloonContent: buildBalloon(props) },
                    { iconLayout: 'default#image', iconImageHref: iconUrl, iconImageSize: [24, 24], iconImageOffset: [-12, -24] }
                );
                layer.geoObjects.add(placemark);
            });
        }

        map.geoObjects.add(layer.geoObjects);
        layers.push(layer);
        currentLayer = layer;

        updateLayerList();
        populateDynamicFilters();
        renderFeatureList();
        return layer;
    }

    function removeLayer(id) {
        const idx = layers.findIndex(l => l.id === id);
        if (idx === -1) return;
        map.geoObjects.remove(layers[idx].geoObjects);
        layers.splice(idx, 1);
        currentLayer = layers.length > 0 ? layers[layers.length - 1] : null;
        updateLayerList();
        renderFeatureList();
    }

    function toggleLayerVisibility(id) {
        const layer = layers.find(l => l.id === id);
        if (!layer) return;
        layer.visible = !layer.visible;
        layer.visible ? map.geoObjects.add(layer.geoObjects) : map.geoObjects.remove(layer.geoObjects);
        updateLayerList();
    }

    function selectLayer(id) {
        currentLayer = layers.find(l => l.id === id) || currentLayer;
        updateLayerList();
        populateDynamicFilters();
        renderFeatureList();
        if (currentLayer?.isRoute) {
            try { map.setBounds(currentLayer.geoObjects.getBounds(), { checkZoomRange: true, zoomMargin: 30 }); } catch(e) {}
        }
    }

    function closeCurrentLayer() {
        if (currentLayer) removeLayer(currentLayer.id);
    }

    function updateLayerList() {
        el.layerList.innerHTML = '';
        if (layers.length === 0) {
            el.layerList.innerHTML = '<div style="padding:8px 14px;font-size:12px;color:var(--text-3)">No layers loaded</div>';
            return;
        }
        layers.forEach(layer => {
            const item = document.createElement('div');
            item.className = 'layer-item' + (layer.id === currentLayer?.id ? ' active' : '');
            item.innerHTML = `
                <span style="font-size:13px">${layer.isRoute ? '🛣️' : '📍'}</span>
                <span class="layer-name">${layer.name}</span>
                <span class="layer-eye">${layer.visible ? '👁' : '🚫'}</span>
            `;
            item.onclick = () => selectLayer(layer.id);
            item.querySelector('.layer-eye').onclick = e => { e.stopPropagation(); toggleLayerVisibility(layer.id); };
            el.layerList.appendChild(item);
        });
    }

    // ─── FEATURE LIST (A-Z + SEARCH) ────────────────────────────
    function getFilteredFeatures() {
        if (!currentLayer || currentLayer.isRoute) return [];
        return currentLayer.features.filter(f => {
            const p = f.properties;
            const name = (p.name || '').toLowerCase();
            const addr = (p.address || '').toLowerCase();
            const matchSearch = !searchQuery || name.includes(searchQuery) || addr.includes(searchQuery) || (p.phone||'').includes(searchQuery);
            
            // Multi-select filters: match if array is empty OR value is in the array
            const matchStatus = currentFilters.status.length === 0 || 
                currentFilters.status.some(s => (p.status||'').toLowerCase() === s.toLowerCase());
            const matchColor = currentFilters.color.length === 0 || 
                currentFilters.color.some(c => (p.color||'').toLowerCase() === c.toLowerCase());
            const matchCar = currentFilters.car.length === 0 || 
                currentFilters.car.includes(p.car);
            const matchDriver = currentFilters.driver.length === 0 || 
                currentFilters.driver.includes(p.driver);
            const matchOwner = currentFilters.owner.length === 0 || 
                currentFilters.owner.includes(p.owner);
            
            const matchDays = currentFilters.days.length === 0 || currentFilters.days.every(d => {
                const v = (p[d] || '').toString().toUpperCase();
                return v === 'TRUE' || v === '1' || v === 'YES';
            });
            return matchSearch && matchStatus && matchColor && matchCar && matchDriver && matchOwner && matchDays;
        });
    }

    function getSortedFilteredFeatures() {
        return [...getFilteredFeatures()].sort((a, b) => {
            const na = (a.properties.name || '').toLowerCase();
            const nb = (b.properties.name || '').toLowerCase();
            return na.localeCompare(nb);
        });
    }

    function renderFeatureList() {
        const features = getFilteredFeatures();
        el.countTotal.textContent = currentLayer?.features?.length || 0;
        el.countShown.textContent = features.length;
        updateAlphaHighlights(features);
        updateMarkedCountLabel();

        if (!currentLayer || currentLayer.isRoute) {
            el.featureList.innerHTML = currentLayer?.isRoute
                ? `<div class="feature-item"><div class="feature-info"><div class="feature-name">🛣️ ${currentLayer.name}</div><div class="feature-meta">${currentLayer.routeInfo?.points || 0} points</div></div></div>`
                : `<div class="empty-state"><div class="icon">📍</div><p>Open a GeoJSON or CSV file to see locations.</p></div>`;
            return;
        }

        if (features.length === 0) {
            el.featureList.innerHTML = `<div class="empty-state"><div class="icon">🔍</div><p>No locations match your search or filters.</p></div>`;
            return;
        }

        // Sort A-Z
        const sorted = getSortedFilteredFeatures();

        // Group by first letter
        const ARMENIAN_ORDER = ['Ա','Բ','Գ','Դ','Ե','Զ','Է','Ը','Թ','Ժ','Ի','Լ','Խ','Ծ','Կ','Հ','Ձ','Ղ','Ճ','Մ','Յ','Ն','Շ','Ո','Չ','Պ','Ջ','Ռ','Ս','Վ','Տ','Ր','Ց','Ւ','Փ','Ք','Օ','Ֆ'];
        const groups = {};
        sorted.forEach(f => {
            const letter = (f.properties.name || '#')[0].toUpperCase();
            const key = /[\u0531-\u0556]/.test(letter) ? letter : '#';
            if (!groups[key]) groups[key] = [];
            groups[key].push(f);
        });

        el.featureList.innerHTML = '';
        const sortedKeys = Object.keys(groups).sort((a, b) => {
            const ai = ARMENIAN_ORDER.indexOf(a);
            const bi = ARMENIAN_ORDER.indexOf(b);
            if (ai === -1 && bi === -1) return a.localeCompare(b);
            if (ai === -1) return 1;
            if (bi === -1) return -1;
            return ai - bi;
        });
        sortedKeys.forEach(letter => {
            const header = document.createElement('div');
            header.className = 'alpha-group-header';
            header.textContent = letter;
            header.dataset.alphaHeader = letter;
            el.featureList.appendChild(header);

            groups[letter].forEach(f => {
                const p = f.properties;
                const isMarked = !!(currentLayer.markedIds && currentLayer.markedIds.has(p.id));
                const item = document.createElement('div');
                item.className = 'feature-item' + (isMarked ? ' marked' : '');

                const dotColor = COLOR_MAP[p.color?.toLowerCase()] || '#ccc';
                const statusClass = p.status ? `status-${p.status.toLowerCase()}` : '';

                // Build day tags
                const openDays = Object.entries(DAYS).filter(([key]) => {
                    const v = (p[key] || '').toString().toUpperCase();
                    return v === 'TRUE' || v === '1' || v === 'YES';
                }).map(([, name]) => name);

                const dayTagsHTML = openDays.length > 0
                    ? openDays.map(d => `<span class="tag open">${d}</span>`).join('')
                    : '';

                const statusTag = p.status ? `<span class="tag ${statusClass}">${p.status}</span>` : '';
                const carTag = p.car ? `<span class="tag">${p.car}</span>` : '';

                item.innerHTML = `
                    <button class="feature-mark-btn${isMarked ? ' marked' : ''}" title="${isMarked ? 'Unmark' : 'Mark for route'}">${isMarked ? '★' : '☆'}</button>
                    <div class="feature-dot" style="background:${dotColor}"></div>
                    <div class="feature-info">
                        <div class="feature-name">${p.name || '—'}</div>
                        ${p.address ? `<div class="feature-meta">${p.address}</div>` : ''}
                        <div class="feature-tags">${statusTag}${carTag}${dayTagsHTML}</div>
                    </div>
                `;
                item.querySelector('.feature-mark-btn').onclick = e => { e.stopPropagation(); toggleMark(f); };
                item.onclick = () => focusFeature(f);
                el.featureList.appendChild(item);
            });
        });

        // Sync map visibility
        syncMapVisibility(features);
    }

    function focusFeature(feature) {
        const coords = parseCoords(feature.properties.coordinates || '');
        if (!coords) return;
        map.setCenter(coords, 16);
        // Find and open balloon
        currentLayer.geoObjects.each(placemark => {
            try {
                if (placemark.properties.get('id') == feature.properties.id) {
                    placemark.balloon.open();
                }
            } catch(e) {}
        });
    }

    // ─── MARKING (for building custom routes) ───────────────────
    // If nothing is marked, the map shows every filtered location as usual.
    // As soon as one location is marked, the map hides everything unmarked,
    // and "Open in Yandex Maps" routes through the marked stops in mark order.
    function toggleMark(feature) {
        if (!currentLayer) return;
        const id = feature.properties.id;
        if (currentLayer.markedIds.has(id)) currentLayer.markedIds.delete(id);
        else currentLayer.markedIds.add(id);
        renderFeatureList();
    }

    function markAllVisible() {
        if (!currentLayer) return;
        getSortedFilteredFeatures().forEach(f => currentLayer.markedIds.add(f.properties.id));
        renderFeatureList();
    }

    function unmarkAll() {
        if (!currentLayer) return;
        currentLayer.markedIds.clear();
        renderFeatureList();
    }

    function updateMarkedCountLabel() {
        const label = $('marked-count-label');
        const count = currentLayer?.markedIds?.size || 0;
        label.textContent = count > 0 ? `${count} marked` : '';
    }

    function syncMapVisibility(visibleFeatures) {
        if (!currentLayer || currentLayer.isRoute) return;
        const hasMarks = currentLayer.markedIds && currentLayer.markedIds.size > 0;
        const visibleIds = new Set(
            hasMarks
                ? visibleFeatures.filter(f => currentLayer.markedIds.has(f.properties.id)).map(f => f.properties.id)
                : visibleFeatures.map(f => f.properties.id)
        );
        currentLayer.geoObjects.each(placemark => {
            try {
                const id = placemark.properties.get('id');
                placemark.options.set('visible', visibleIds.has(id));
            } catch(e) {}
        });
    }

    // ─── FILTERS ──────────────────────────────────────────────────
    function applyFilters() {
        // Collect checked values from each checkbox list
        currentFilters.status = Array.from(el.filterStatusList.querySelectorAll('input:checked')).map(cb => cb.value);
        currentFilters.color = Array.from(el.filterColorList.querySelectorAll('input:checked')).map(cb => cb.value);
        currentFilters.car = Array.from(el.filterCarList.querySelectorAll('input:checked')).map(cb => cb.value);
        currentFilters.driver = Array.from(el.filterDriverList.querySelectorAll('input:checked')).map(cb => cb.value);
        currentFilters.owner = Array.from(el.filterOwnerList.querySelectorAll('input:checked')).map(cb => cb.value);
        // days already updated via toggle clicks
        renderFeatureList();
    }

    function clearFilters() {
        // Uncheck all checkboxes
        el.filterStatusList.querySelectorAll('input').forEach(cb => cb.checked = false);
        el.filterColorList.querySelectorAll('input').forEach(cb => cb.checked = false);
        el.filterCarList.querySelectorAll('input').forEach(cb => cb.checked = false);
        el.filterDriverList.querySelectorAll('input').forEach(cb => cb.checked = false);
        el.filterOwnerList.querySelectorAll('input').forEach(cb => cb.checked = false);
        currentFilters = { status:[], color:[], car:[], driver:[], owner:[], days:[] };
        el.weekdayToggles.forEach(t => t.classList.remove('on'));
        searchQuery = '';
        el.searchInput.value = '';
        renderFeatureList();
    }

    function showMyLocation() {
        if (!navigator.geolocation) {
            alert('Geolocation is not supported by your browser');
            return;
        }

        const btn = $('my-location-btn');
        btn.classList.add('active');

        navigator.geolocation.getCurrentPosition(
            position => {
                const { latitude, longitude } = position.coords;
                const coords = [latitude, longitude];

                // Remove old marker if exists
                if (userLocationMarker) {
                    map.geoObjects.remove(userLocationMarker);
                }

                // Create a custom marker for user location
                userLocationMarker = new ymaps.Placemark(coords, {
                    hintContent: 'Your Location',
                    balloonContent: `Your current location<br>Accuracy: ±${Math.round(position.coords.accuracy)}m`
                }, {
                    preset: 'islands#blueDotIcon',
                    iconColor: '#4285F4'
                });

                map.geoObjects.add(userLocationMarker);
                map.setCenter(coords, 15, { duration: 500 });

                btn.classList.remove('active');
            },
            error => {
                btn.classList.remove('active');
                let message = 'Unable to get your location';
                switch(error.code) {
                    case error.PERMISSION_DENIED:
                        message = 'Location access denied. Please allow location access in your browser settings.';
                        break;
                    case error.POSITION_UNAVAILABLE:
                        message = 'Location information unavailable';
                        break;
                    case error.TIMEOUT:
                        message = 'Location request timed out';
                        break;
                }
                alert(message);
            },
            {
                enableHighAccuracy: true,
                timeout: 10000,
                maximumAge: 0
            }
        );
    }

    function populateDynamicFilters() {
        if (!currentLayer || currentLayer.isRoute) return;
        const statuses = new Set();
        const colors = new Set();
        const cars = new Set();
        const drivers = new Set();
        const owners = new Set();
        currentLayer.features.forEach(f => {
            if (f.properties.status) statuses.add(f.properties.status);
            if (f.properties.color) colors.add(f.properties.color);
            if (f.properties.car) cars.add(f.properties.car);
            if (f.properties.driver) drivers.add(f.properties.driver);
            if (f.properties.owner) owners.add(f.properties.owner);
        });
        
        const createCheckboxList = (container, values, filterKey) => {
            container.innerHTML = '';
            [...values].sort().forEach(v => {
                const item = document.createElement('label');
                item.className = 'filter-checkbox-item';
                
                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.value = v;
                checkbox.checked = currentFilters[filterKey].includes(v);
                checkbox.addEventListener('change', applyFilters);
                
                const label = document.createElement('span');
                label.className = 'filter-checkbox-label';
                label.textContent = v;
                
                item.appendChild(checkbox);
                item.appendChild(label);
                container.appendChild(item);
            });
        };
        
        createCheckboxList(el.filterStatusList, statuses, 'status');
        createCheckboxList(el.filterColorList, colors, 'color');
        createCheckboxList(el.filterCarList, cars, 'car');
        createCheckboxList(el.filterDriverList, drivers, 'driver');
        createCheckboxList(el.filterOwnerList, owners, 'owner');
    }

    // ─── IMPORT: GeoJSON ─────────────────────────────────────────
    function importGeoJSON(e) {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = ev => {
            try {
                const data = JSON.parse(ev.target.result);
                if (data.type !== 'FeatureCollection') throw new Error('Invalid GeoJSON');
                addLayer(data, file.name.replace(/\.[^.]+$/, ''));
            } catch (err) {
                alert('Error reading GeoJSON: ' + err.message);
            }
        };
        reader.readAsText(file);
        e.target.value = '';
    }

    // ─── IMPORT: KML ──────────────────────────────────────────────
    function importKML(e) {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = ev => {
            try {
                const kmlDoc = new DOMParser().parseFromString(ev.target.result, 'text/xml');
                const ns = 'http://www.opengis.net/kml/2.2';
                const placemarks = kmlDoc.getElementsByTagNameNS(ns, 'Placemark');
                if (!placemarks.length) throw new Error('No placemarks found');
                const layerName = file.name.replace(/\.[^.]+$/, '');
                for (let pm of placemarks) {
                    for (let ls of pm.getElementsByTagNameNS(ns, 'LineString')) {
                        const coords = ls.getElementsByTagNameNS(ns, 'coordinates')[0]?.textContent.trim();
                        if (!coords) continue;
                        const pts = coords.split(/\s+/).map(p => {
                            const [lon, lat] = p.split(',').map(parseFloat);
                            return isNaN(lat) ? null : [lat, lon];
                        }).filter(Boolean);
                        if (pts.length > 1) {
                            addLayer(pts, layerName, true);
                            try { map.setBounds(getBounds(pts), { checkZoomRange: true, zoomMargin: 30 }); } catch(e) {}
                            break;
                        }
                    }
                }
            } catch (err) {
                alert('KML error: ' + err.message);
            }
        };
        reader.readAsText(file);
        e.target.value = '';
    }

    // ─── IMPORT: CSV ──────────────────────────────────────────────
    function importCSV(e) {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = ev => parseCSVText(ev.target.result, file.name.replace(/\.[^.]+$/, ''));
        reader.readAsText(file);
        e.target.value = '';
    }

    function parseCSVText(raw, layerName) {
        try {
            const lines = raw.split('\n').filter(l => l.trim());
            if (lines.length < 2) throw new Error('Need at least a header + one data row');

            // Detect separator
            const sep = lines[0].includes('\t') ? '\t' : ',';
            const headers = lines[0].split(sep).map(h => h.trim().toLowerCase().replace(/['"]/g, ''));

            const features = [];
            for (let i = 1; i < lines.length; i++) {
                const vals = splitCSVLine(lines[i], sep);
                if (vals.length < 2) continue;
                const props = {};
                headers.forEach((h, idx) => { props[h] = (vals[idx] || '').trim().replace(/^["']|["']$/g, ''); });

                // Normalize column names
                const p = {
                    id: props.id || i,
                    name: props.name || props.NAME || '',
                    address: props.address || props.ADDRESS || '',
                    coordinates: props.coordinates || props.cordinates || props.coords || '',
                    phone: props.phone || props.PHONE || '',
                    owner: props.owner || props.OWNER || '',
                    W1: props.w1 || props.W1 || '',
                    W2: props.w2 || props.W2 || '',
                    W3: props.w3 || props.W3 || '',
                    W4: props.w4 || props.W4 || '',
                    W5: props.w5 || props.W5 || '',
                    W6: props.w6 || props.W6 || '',
                    W7: props.w7 || props.W7 || '',
                    car: props.car || props.CAR || '',
                    driver: props.driver || props.DRIVER || '',
                    status: props.status || props.STATUS || '',
                    color: props.color || props.COLOR || '',
                    site: props.site || props.SITE || '',
                    description: props.description || props.DESCRIPTION || '',
                };

                const coords = parseCoords(p.coordinates);
                if (!coords) continue;

                features.push({
                    type: 'Feature',
                    geometry: { type: 'Point', coordinates: [coords[1], coords[0]] },
                    properties: p
                });
            }

            if (features.length === 0) throw new Error('No valid locations found (check COORDINATES column)');
            addLayer({ type: 'FeatureCollection', features }, layerName);
            // Switch to locations tab
            document.querySelector('[data-tab="locations"]').click();
        } catch (err) {
            alert('CSV import error: ' + err.message);
        }
    }

    function splitCSVLine(line, sep) {
        // Handle quoted fields
        if (sep === ',') {
            const res = [];
            let cur = '', inQ = false;
            for (let c of line) {
                if (c === '"') { inQ = !inQ; }
                else if (c === sep && !inQ) { res.push(cur); cur = ''; }
                else { cur += c; }
            }
            res.push(cur);
            return res;
        }
        return line.split(sep);
    }

    // ─── QUICK LOAD (same folder as index.html) ─────────────────────
    // Loads a file by relative fetch instead of the OS file picker, so files that
    // live next to index.html (e.g. on GitHub Pages, or served via a local dev
    // server) can be opened by typing their name. This uses fetch(), so it only
    // works when the page is served over http(s) — not when opened directly as a
    // file:// URL, since browsers block fetch() of local files for security reasons.
    function quickLoadFromFolder() {
        const status = $('quickload-status');
        const input = $('quickload-filename');
        const fname = input.value.trim();
        if (!fname) {
            status.className = 'route-status error';
            status.textContent = 'Enter a filename.';
            return;
        }
        const ext = fname.split('.').pop().toLowerCase();
        if (!['csv', 'json', 'geojson'].includes(ext)) {
            status.className = 'route-status error';
            status.textContent = 'Only .csv and .json/.geojson files are supported here.';
            return;
        }
        status.className = 'route-status';
        status.textContent = 'Loading…';

        const url = new URL(fname, window.location.href).href;
        fetch(url, { cache: 'no-store' })
            .then(res => {
                if (!res.ok) throw new Error(`HTTP ${res.status} — file not found next to this page`);
                return res.text();
            })
            .then(text => {
                const baseName = fname.replace(/\.[^.]+$/, '');
                if (ext === 'csv') {
                    parseCSVText(text, baseName);
                    status.className = 'route-status success';
                    status.textContent = `Loaded "${fname}" as a location layer.`;
                } else {
                    let data;
                    try { data = JSON.parse(text); } catch (e) { throw new Error('Not valid JSON'); }
                    if (data && data.type === 'FeatureCollection') {
                        addLayer(data, baseName);
                        status.className = 'route-status success';
                        status.textContent = `Loaded "${fname}" as a location layer.`;
                    } else if (Array.isArray(data)) {
                        const loaded = importDrawingsFromData(data);
                        status.className = 'route-status success';
                        status.textContent = `Loaded "${fname}" — ${loaded} drawing(s).`;
                    } else {
                        throw new Error('Unrecognized JSON — expected a GeoJSON FeatureCollection or a drawings export');
                    }
                }
            })
            .catch(err => {
                status.className = 'route-status error';
                status.textContent = `Could not load "${fname}": ${err.message}.`;
            });
    }

    // ─── HELPERS ──────────────────────────────────────────────────
    function parseCoords(str) {
        if (!str) return null;
        const parts = str.toString().split(',').map(s => parseFloat(s.trim()));
        if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
            return [parts[0], parts[1]]; // [lat, lon]
        }
        return null;
    }

    function createTriangleIcon(color) {
        const svg = `<svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 22 L2 2 L22 2 Z" fill="${color}" stroke="#fff" stroke-width="1.5"/>
        </svg>`;
        return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    }

    function buildBalloon(p) {
        const openDays = Object.entries(DAYS).filter(([key]) => {
            const v = (p[key] || '').toString().toUpperCase();
            return v === 'TRUE' || v === '1' || v === 'YES';
        }).map(([, name]) => name);

        const daysHTML = openDays.length > 0
            ? `<div class="balloon-days">${openDays.map(d => `<span class="balloon-day">${d}</span>`).join('')}</div>` : '';

        const phoneHTML = p.phone ? `<div class="balloon-row"><span>Phone</span> <a href="tel:${p.phone}">${p.phone}</a></div>` : '';
        const siteHTML = p.site ? `<div class="balloon-row balloon-site"><span>Site</span> <a href="${p.site}" target="_blank">${p.site}</a></div>` : '';
        const descHTML = p.description ? `<div class="balloon-row" style="margin-top:6px;font-size:11px;color:#666">${p.description}</div>` : '';

        return `<div class="balloon-content">
            <strong>${p.name || 'Unnamed'}</strong>
            ${p.address ? `<div class="balloon-row"><span>Address</span> ${p.address}</div>` : ''}
            ${p.status ? `<div class="balloon-row"><span>Status</span> ${p.status}</div>` : ''}
            ${p.owner ? `<div class="balloon-row"><span>Owner</span> ${p.owner}</div>` : ''}
            ${phoneHTML}
            ${p.car ? `<div class="balloon-row"><span>Car</span> ${p.car}</div>` : ''}
            ${p.driver ? `<div class="balloon-row"><span>Driver</span> ${p.driver}</div>` : ''}
            ${siteHTML}
            ${daysHTML}
            ${descHTML}
        </div>`;
    }

    function getBounds(coords) {
        let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
        coords.forEach(([lat, lon]) => {
            minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat);
            minLon = Math.min(minLon, lon); maxLon = Math.max(maxLon, lon);
        });
        return [[minLat, minLon], [maxLat, maxLon]];
    }

    // ─── MOBILE NAV ──────────────────────────────────────────────
    // Runs after DOM is ready; doesn't need ymaps
    (function initMobileNav() {
        const sidebarEl = document.getElementById('sidebar');
        const navBtns = document.querySelectorAll('.mobile-nav-btn');

        function switchTab(tab) {
            navBtns.forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
            if (tab === 'map') {
                sidebarEl.classList.remove('mobile-open');
                return;
            }
            sidebarEl.classList.add('mobile-open');
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
            document.querySelectorAll('.panel').forEach(p => p.classList.toggle('active', p.id === tab + '-panel'));
            activeTab = tab;
        }

        navBtns.forEach(btn => btn.addEventListener('click', () => switchTab(btn.dataset.tab)));

        document.getElementById('map').addEventListener('click', () => {
            if (window.innerWidth <= 640) switchTab('map');
        });

        const handle = document.getElementById('mobile-drag-handle');
        let startY = 0;
        handle.addEventListener('touchstart', e => { startY = e.touches[0].clientY; }, { passive: true });
        handle.addEventListener('touchend', e => {
            if (e.changedTouches[0].clientY - startY > 60) switchTab('map');
        }, { passive: true });

        window.addEventListener('resize', () => {
            if (window.innerWidth > 640) sidebarEl.classList.remove('mobile-open');
        });
    })();
