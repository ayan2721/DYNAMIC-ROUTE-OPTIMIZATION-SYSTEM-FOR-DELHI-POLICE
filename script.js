document.addEventListener('DOMContentLoaded', function() {
    // Initialize Delhi map with satellite view
    const map = L.map('map').setView([28.6139, 77.2090], 13);

    // Add Esri's World Imagery tile layer
    L.esri.basemapLayer('Imagery', {
        attribution: 'Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics'
    }).addTo(map);

    // Add labels/roads on top
    L.esri.basemapLayer('ImageryLabels').addTo(map);

    // Map state variables
    let startMarker = null;
    let endMarker = null;
    let routeLayer = null;
    let selectionMode = 'start';
    let roadBlockMode = false;
    let blockedRoads = [];
    let emergencyType = 'high';

    // UI References
    const currentModeDisplay = document.getElementById('current-selection-mode');
    const setStartBtn = document.getElementById('set-start');
    const setEndBtn = document.getElementById('set-end');
    const clearPointsBtn = document.getElementById('clear-points');
    const calculateRouteBtn = document.getElementById('calculate-route');
    const routeInfoDiv = document.getElementById('route-info');
    const routeSummaryDiv = document.getElementById('route-summary');
    const etaDisplay = document.getElementById('eta-display');
    const emergencyOptions = document.querySelectorAll('.emergency-option');
    const blockRoadBtn = document.getElementById('block-road-mode');
    const blockedRoadsList = document.getElementById('blocked-roads-list');
    const simulateTrafficBtn = document.getElementById('simulate-traffic');

    // Event Listeners for UI Controls
    setStartBtn.addEventListener('click', () => {
        selectionMode = 'start';
        updateSelectionModeDisplay();
    });

    setEndBtn.addEventListener('click', () => {
        selectionMode = 'end';
        updateSelectionModeDisplay();
    });

    clearPointsBtn.addEventListener('click', clearAllPoints);
    calculateRouteBtn.addEventListener('click', calculateOptimalRoute);

    emergencyOptions.forEach(option => {
        option.addEventListener('click', () => {
            emergencyOptions.forEach(opt => opt.classList.remove('selected'));
            option.classList.add('selected');
            emergencyType = option.dataset.type;
        });
    });

    blockRoadBtn.addEventListener('click', toggleRoadBlockMode);
    simulateTrafficBtn.addEventListener('click', simulateTrafficConditions);

    // Map click handler
    map.on('click', function(e) {
        if (roadBlockMode) {
            // Handle road block creation
            addRoadBlock(e.latlng);
        } else {
            // Handle start/end point selection
            if (selectionMode === 'start') {
                setStartPoint(e.latlng);
            } else {
                setEndPoint(e.latlng);
            }
        }
    });

    // Function to update the selection mode display
    function updateSelectionModeDisplay() {
        currentModeDisplay.textContent =
            selectionMode === 'start' ? 'Start Point' : 'End Point';
    }

    // Function to set the start point
    function setStartPoint(latlng) {
        if (startMarker) {
            map.removeLayer(startMarker);
        }

        startMarker = L.marker(latlng, {
            icon: L.divIcon({
                className: 'start-marker',
                html: '<div style="background-color: #2ecc71; border-radius: 50%; width: 20px; height: 20px; border: 3px solid white;"></div>',
                iconSize: [26, 26],
                iconAnchor: [13, 13]
            })
        }).addTo(map);

        startMarker.bindPopup("Start Point").openPopup();

        // Update UI
        if (startMarker && endMarker) {
            calculateRouteBtn.disabled = false;
        }
    }

    // Function to set the end point
    function setEndPoint(latlng) {
        if (endMarker) {
            map.removeLayer(endMarker);
        }

        endMarker = L.marker(latlng, {
            icon: L.divIcon({
                className: 'end-marker',
                html: '<div style="background-color: #e74c3c; border-radius: 50%; width: 20px; height: 20px; border: 3px solid white;"></div>',
                iconSize: [26, 26],
                iconAnchor: [13, 13]
            })
        }).addTo(map);

        endMarker.bindPopup("End Point").openPopup();

        // Update UI
        if (startMarker && endMarker) {
            calculateRouteBtn.disabled = false;
        }
    }

    // Function to clear all points and route
    function clearAllPoints() {
        if (startMarker) {
            map.removeLayer(startMarker);
            startMarker = null;
        }

        if (endMarker) {
            map.removeLayer(endMarker);
            endMarker = null;
        }

        if (routeLayer) {
            map.removeLayer(routeLayer);
            routeLayer = null;
        }

        // Clear UI elements
        routeInfoDiv.style.display = 'none';
        calculateRouteBtn.disabled = true;

        // Clear blocked roads
        blockedRoads.forEach(road => map.removeLayer(road.marker));
        blockedRoads = [];
        updateBlockedRoadsList();
    }

    // Dijkstra's algorithm implementation for shortest path
    function dijkstra(start, end, roadNetwork, blockedRoads) {
        const distances = {};
        const previous = {};
        const queue = new PriorityQueue();

        // Initialize distances
        roadNetwork.forEach(node => {
            distances[node.id] = node.id === start.id ? 0 : Infinity;
            queue.enqueue(node, node.id === start.id ? 0 : Infinity);
        });

        while (!queue.isEmpty()) {
            const current = queue.dequeue().element;

            // Found the shortest path
            if (current.id === end.id) break;

            current.neighbors.forEach(neighbor => {
                // Skip blocked roads
                const isBlocked = blockedRoads.some(blocked =>
                    (blocked.latlng.lat === current.lat && blocked.latlng.lng === current.lng) ||
                    (blocked.latlng.lat === neighbor.lat && blocked.latlng.lng === neighbor.lng)
                );

                if (isBlocked) return;

                const alt = distances[current.id] + neighbor.weight;
                if (alt < distances[neighbor.id]) {
                    distances[neighbor.id] = alt;
                    previous[neighbor.id] = current.id;
                    queue.enqueue(roadNetwork[neighbor.id], alt);
                }
            });
        }

        return {
            distances,
            previous
        };
    }

    // Function to calculate the optimal route using OSRM API
    async function calculateOptimalRoute() {
        if (!startMarker || !endMarker) {
            alert("Please set both start and end points first.");
            return;
        }

        calculateRouteBtn.textContent = "Calculating...";
        calculateRouteBtn.disabled = true;

        try {
            const startLatLng = startMarker.getLatLng();
            const endLatLng = endMarker.getLatLng();

            // Get actual route from OSRM
            const response = await fetch(
                `https://router.project-osrm.org/route/v1/driving/${startLatLng.lng},${startLatLng.lat};${endLatLng.lng},${endLatLng.lat}?overview=full&geometries=geojson`
            );
            const data = await response.json();

            if (data.code !== 'Ok') {
                throw new Error('Failed to calculate route');
            }

            const route = data.routes[0];
            const distance = route.distance;
            const duration = route.duration;
            const pathPoints = route.geometry.coordinates.map(coord => [coord[1], coord[0]]);

            // Adjust ETA based on emergency priority
            const baseEta = duration / 60; // convert seconds to minutes
            let adjustedEta = baseEta;
            if (emergencyType === 'high') {
                adjustedEta = baseEta * 0.7; // 30% faster for emergencies
            } else if (emergencyType === 'medium') {
                adjustedEta = baseEta * 0.85; // 15% faster for medium priority
            }

            const routeData = {
                route: pathPoints,
                distance: distance,
                eta: Math.round(adjustedEta),
                algorithm: 'OSRM'
            };

            // Display the route on the map
            displayRoute(routeData.route, routeData.algorithm);

            // Update the route info panel
            routeSummaryDiv.innerHTML = `
                <p><strong>Algorithm Used:</strong> ${routeData.algorithm}</p>
                <p><strong>Distance:</strong> ${(routeData.distance / 1000).toFixed(2)} km</p>
                <p><strong>Road Conditions:</strong> ${emergencyType} priority</p>
            `;

            etaDisplay.textContent = `Estimated Arrival Time: ${routeData.eta} minutes`;
            routeInfoDiv.style.display = 'block';

        } catch (error) {
            console.error("Error calculating route:", error);
            let errorMsg = 'Routing failed';
            if (error.message.includes('NoRoute')) {
                errorMsg = 'No valid road route found between points - please select different locations';
            } else {
                errorMsg = error.message;
            }
            alert(errorMsg);
        } finally {
            calculateRouteBtn.textContent = "Calculate Optimal Route";
            calculateRouteBtn.disabled = false;
        }
    }

    // Function to generate a simulated route (simplified for demo)
    function generateSimulatedRoute(start, end, priority, blockedPoints) {
        const points = [];
        const steps = 10;

        // Adjust route based on priority
        let curvature = priority === 'high' ? 0.1 :
            priority === 'medium' ? 0.3 : 0.5;

        // Generate a curved path
        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            const lat = start.lat + (end.lat - start.lat) * t;
            const lng = start.lng + (end.lng - start.lng) * t +
                Math.sin(t * Math.PI) * curvature;

            points.push([lat, lng]);
        }

        // Add some variation based on blocked roads
        if (blockedPoints.length > 0) {
            const midIndex = Math.floor(points.length / 2);
            points[midIndex][0] += 0.002;
            points[midIndex][1] -= 0.003;

            if (priority === 'high') {
                // More aggressive detour for high priority
                points[midIndex - 1][0] += 0.001;
                points[midIndex + 1][0] += 0.001;
            }
        }

        return points;
    }

    // Function to display the route on the map
    function displayRoute(routePoints) {
        if (routeLayer) {
            map.removeLayer(routeLayer);
        }

        // Style based on emergency priority - brighter colors for satellite
        const style = {
            color: emergencyType === 'high' ? '#ff0000' : '#00a8ff',
            weight: emergencyType === 'high' ? 6 : 5,
            opacity: 0.9,
            fillOpacity: 0.7,
            dashArray: null,
            lineCap: 'round',
            lineJoin: 'round'
        };

        routeLayer = L.polyline(routePoints, style).addTo(map);
        map.fitBounds(routeLayer.getBounds());
    }

    // Function to toggle road block mode
    function toggleRoadBlockMode() {
        roadBlockMode = !roadBlockMode;
        blockRoadBtn.textContent = roadBlockMode ?
            'Disable Road Block Mode' : 'Enable Road Block Mode';

        blockRoadBtn.style.backgroundColor = roadBlockMode ? '#e74c3c' : '#3498db';

        // Update selection mode display
        if (roadBlockMode) {
            currentModeDisplay.textContent = 'Road Block Mode';
        } else {
            updateSelectionModeDisplay();
        }
    }

    // Function to add a road block at the clicked location
    function addRoadBlock(latlng) {
        // Check if this location is already blocked
        const existingIndex = blockedRoads.findIndex(r =>
            r.latlng.lat === latlng.lat && r.latlng.lng === latlng.lng);

        if (existingIndex >= 0) {
            // Remove the existing block
            map.removeLayer(blockedRoads[existingIndex].marker);
            blockedRoads.splice(existingIndex, 1);
        } else {
            // Add a new block with priority-based weight
            const weight = emergencyType === 'high' ? 100 : // High penalty for high priority
                emergencyType === 'medium' ? 50 : 20;

            const marker = L.marker(latlng, {
                icon: L.divIcon({
                    className: 'road-block-marker',
                    html: '<div style="background-color: #e74c3c; border-radius: 50%; width: 15px; height: 15px; border: 2px solid white; box-shadow: 0 0 0 2px white;"></div>',
                    iconSize: [24, 24],
                    iconAnchor: [12, 12]
                })
            }).addTo(map).bindPopup(`Blocked Road (Weight: ${weight})`);

            blockedRoads.push({
                latlng: latlng,
                marker: marker,
                weight: weight
            });
        }

        updateBlockedRoadsList();
    }

    // Function to update the blocked roads list
    function updateBlockedRoadsList() {
        blockedRoadsList.innerHTML = '<h4>Blocked Roads:</h4>';

        if (blockedRoads.length === 0) {
            blockedRoadsList.innerHTML += '<p>No roads blocked</p>';
            return;
        }

        const list = document.createElement('ul');
        blockedRoads.forEach((road, index) => {
            const item = document.createElement('li');
            item.style.marginBottom = '0.5rem';

            const coords = document.createElement('span');
            coords.textContent = `Lat: ${road.latlng.lat.toFixed(4)}, Lng: ${road.latlng.lng.toFixed(4)}`;

            const removeBtn = document.createElement('button');
            removeBtn.textContent = 'Remove';
            removeBtn.style.marginLeft = '0.5rem';
            removeBtn.style.padding = '0.2rem 0.5rem';
            removeBtn.style.fontSize = '0.8rem';
            removeBtn.style.backgroundColor = '#e74c3c';

            removeBtn.addEventListener('click', () => {
                map.removeLayer(road.marker);
                blockedRoads.splice(index, 1);
                updateBlockedRoadsList();
            });

            item.appendChild(coords);
            item.appendChild(removeBtn);
            list.appendChild(item);
        });

        blockedRoadsList.appendChild(list);
    }

    // Function to simulate traffic conditions (random delays on route)
    function simulateTrafficConditions() {
        if (!routeLayer) {
            alert("No route to simulate traffic on.");
            return;
        }

        const originalRoute = routeLayer.getLatLngs();
        const modifiedRoute = [];

        // Add random delays to some segments
        originalRoute.forEach((point, index) => {
            modifiedRoute.push(point);

            // Randomly add traffic to some segments
            if (index < originalRoute.length - 1 && Math.random() > 0.7) {
                const nextPoint = originalRoute[index + 1];
                const midLat = (point.lat + nextPoint.lat) / 2;
                const midLng = (point.lng + nextPoint.lng) / 2;

                // Add a traffic marker
                L.marker([midLat, midLng], {
                    icon: L.divIcon({
                        className: 'traffic-marker',
                        html: '<div style="background-color: #f39c12; border-radius: 50%; width: 12px; height: 12px; border: 2px solid white;"></div>',
                        iconSize: [16, 16],
                        iconAnchor: [8, 8]
                    })
                }).addTo(map).bindPopup("Traffic Delay");

                // Slightly adjust the route to show detour
                modifiedRoute.push({
                    lat: midLat + 0.0005,
                    lng: midLng - 0.0005
                });
            }
        });

        // Update the route with traffic
        routeLayer.setLatLngs(modifiedRoute);

        // Update ETA with traffic delay
        const currentEta = parseInt(etaDisplay.textContent.match(/\d+/)[0]);
        const newEta = currentEta + Math.floor(Math.random() * 5) + 2;
        etaDisplay.textContent = `Estimated Arrival Time: ${newEta} minutes (with traffic)`;
        routeSummaryDiv.innerHTML += `<p><strong>Note:</strong> Simulated traffic delays added</p>`;
    }

    // Initialize UI
    updateSelectionModeDisplay();
    calculateRouteBtn.disabled = true;

    // Select high priority by default
    document.querySelector('.emergency-option[data-type="high"]').click();
});