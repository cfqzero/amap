// main.js

// Gaode Maps API Key and Security Key
window._AMapSecurityConfig = {
    securityJsCode: 'd0238166178c6531b3fcb0085efd8a9c', // 替换为您的安全密钥
};

let map, scene, camera, renderer, customLayer;
let buildingMeshes = []; // 用于存放建筑物的数组

function initGaodeMap() {
    map = new AMap.Map('map-container', {
        center: [116.397428, 39.90923], // 默认中心点：北京天安门
        zoom: 15,
        viewMode: '3D', // 开启3D视图
        pitch: 60, // 俯仰角度
        mapStyle: 'amap://styles/darkblue', // 使用深蓝色调地图样式
    });

    // 添加地图控件
    map.addControl(new AMap.Scale());
    map.addControl(new AMap.ToolBar());
    map.addControl(new AMap.ControlBar());

    // 当地图加载完成后，初始化Three.js场景
    map.on('complete', function() {
        console.log('Gaode Map loaded completely.');
        initThreeJS();
    });

    // 当地图视图发生变化时，同步Three.js相机
    map.on('viewchange', function() {
        if (customLayer) {
            customLayer.render(); // 请求重绘Three.js图层
        }
    });
}

function initThreeJS() {
    // 1. 创建Three.js场景
    scene = new THREE.Scene();

    // 添加环境光
    const ambientLight = new THREE.AmbientLight(0x404040, 1.5); // 柔和的白光，强度1.5
    scene.add(ambientLight);

    // 添加平行光
    const directionalLight = new THREE.DirectionalLight(0xffffff, 1.0); // 白色平行光，强度1.0
    directionalLight.position.set(50, 100, 25); // 设置光源位置，影响方向
    directionalLight.castShadow = true; // 允许光源产生阴影 (阴影配置更复杂，此处仅开启)
    scene.add(directionalLight);

    // 2. 创建相机
    // 使用一个广角相机，参数：视野角度（FOV），宽高比（aspect ratio），近裁剪面（near），远裁剪面（far）
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 10000);
    // 相机位置稍作调整，以便观察场景，后续会由高德地图同步
    camera.position.set(0, 0, 100);


    // 3. 创建渲染器
    renderer = new THREE.WebGLRenderer({
        alpha: true, // 设置背景透明，以便看到高德地图
        antialias: true, // 抗锯齿
    });
    renderer.setSize(window.innerWidth, window.innerHeight);
    // 注意：Three.js的DOM元素不需要手动添加到map-container，CustomLayer会自动处理

    // 4. 创建自定义图层 CustomLayer
    // 这个图层允许我们将Three.js场景渲染到高德地图上
    customLayer = new AMap.CustomLayer(renderer.domElement, {
        zIndex: 120, // 设置图层层级
        render: onThreeJSRender, // 设置渲染函数
    });
    map.add(customLayer); // 将自定义图层添加到地图上

    // 5. 添加简单的立方体作为建筑占位符
    addSampleBuildings();

    // Initialize placeholders for map center reference for Three.js coordinate system
    // These will be set on the first render pass of onThreeJSRender
    window.mapInitCenterLngLat = null;
    window.sceneOriginFlat = null;

    // 6. 开始渲染循环 (虽然CustomLayer有自己的render回调，但有时也需要独立的动画循环)
    // animate(); // CustomLayer的render回调通常足够，除非有独立于地图的动画
}

function onThreeJSRender() {
    // 当高德地图需要重绘时，此函数会被调用

    // 同步Three.js相机与高德地图相机
    // 高德地图提供了获取viewMatrix和projectionMatrix的方法
    // 这些矩阵可以直接用于Three.js相机
    const { viewMatrix, projectionMatrix } = map.getViewMatrixAndProjectionMatrix();

    if (viewMatrix && projectionMatrix) {
        const vm = new THREE.Matrix4().fromArray(viewMatrix);
        const pm = new THREE.Matrix4().fromArray(projectionMatrix);

        // 设置Three.js相机的投影矩阵
        camera.projectionMatrix.copy(pm);

        // 设置Three.js相机的视图矩阵的逆矩阵 (模型视图矩阵)
        // Three.js的相机矩阵是模型视图矩阵的逆
        camera.matrixWorldInverse.copy(vm);
        camera.matrixWorld.copy(vm).invert(); // 或者 camera.matrixWorld.getInverse(vm);

        // 更新相机的姿态（位置和旋转）
        // camera.position.setFromMatrixPosition(camera.matrixWorld); // 从世界矩阵中提取位置
        // camera.quaternion.setFromRotationMatrix(camera.matrixWorld); // 从世界矩阵中提取旋转

        // 如果直接使用matrixWorldInverse和projectionMatrix，通常不需要单独更新position和quaternion
    }


    renderer.resetState(); // 重置渲染器状态，重要！

    // 更新建筑物的精确位置
    // The goal is to position Three.js objects at specific geographic coordinates.
    // A common strategy with AMap.CustomLayer and its view/projection matrix synchronization
    // is to establish a fixed origin for the Three.js world space that corresponds to a known LngLat.
    // All geographic coordinates are then converted to meter offsets from this fixed origin.

    // Initialize the Three.js scene origin on the first render pass if not already set.
    if (!window.mapInitCenterLngLat && map) { // Ensure map object is available
        window.mapInitCenterLngLat = map.getCenter(); // Store map's initial center LngLat
        if (window.mapInitCenterLngLat) {
            // Convert this LngLat to flat coordinates (meters) to act as the (0,0) point for our Three.js scene's XZ plane
            window.sceneOriginFlat = map.lngLatToFlat(window.mapInitCenterLngLat);
            console.log("Three.js scene origin set to map center:", window.mapInitCenterLngLat.toString(), "-> Flat Coords:", window.sceneOriginFlat);
        }
    }

    // Proceed only if the scene origin has been successfully established
    if (window.sceneOriginFlat) {
        buildingMeshes.forEach(mesh => {
            const buildingLngLat = mesh.userData.lngLat; // This is an AMap.LngLat object
            if (!buildingLngLat || typeof mesh.userData.height === 'undefined') {
                console.warn("Mesh is missing lngLat or height data", mesh);
                return;
            }

            // Convert the building's LngLat to flat coordinates (meters)
            const buildingFlatCoords = map.lngLatToFlat(buildingLngLat);

            // Calculate the offset from the Three.js scene's origin (which is tied to mapInitCenterLngLat)
            // These offsets are in meters.
            const offsetX = buildingFlatCoords.x - window.sceneOriginFlat.x;
            // The Y offset from lngLatToFlat corresponds to the North-South axis.
            // In a Y-up Three.js scene, this typically maps to the Z-axis.
            const offsetZ_from_lat = buildingFlatCoords.y - window.sceneOriginFlat.y;

            // Set the mesh's position in the Three.js scene:
            // - X from the flat coordinates becomes X in Three.js.
            // - The Y position in Three.js is the building's height (base at ground level, center at height/2).
            // - The Y from flat coordinates (latitude offset) becomes Z in Three.js.
            //   A common convention is that positive latitude (North) maps to negative Z in right-handed
            //   coordinate systems where Y is up and camera looks down -Z. This needs verification by observation.
            mesh.position.set(offsetX, mesh.userData.height / 2, -offsetZ_from_lat);
            // console.log(`Building at ${buildingLngLat.toString()}: Flat (${buildingFlatCoords.x.toFixed(2)}, ${buildingFlatCoords.y.toFixed(2)}) -> Scene Pos (${offsetX.toFixed(2)}, ${mesh.userData.height / 2}, ${-offsetZ_from_lat.toFixed(2)})`);
        });
    }

    renderer.render(scene, camera);
    renderer.resetState(); // 再次重置，确保状态干净
}

function addSampleBuildings() {
    // 示例：在地图上添加几个简单的立方体建筑
    // 坐标需要是高德地图的经纬度坐标
    // TODO: 此处的建筑数据是示例，将来可以替换为从外部加载（如GeoJSON）
    const buildingData = [
        // position: [longitude, latitude, altitude (currently not used for positioning but can be stored)]
        // size: [width, depth, height] (mapping to BoxGeometry: width, height, depth)
        { position: [116.397428, 39.90923, 0], size: [20, 20, 100] }, // 天安门附近
        { position: [116.403988, 39.91508, 0], size: [30, 30, 150] }, // 故宫附近
        { position: [116.380838, 39.91355, 0], size: [25, 25, 50] },  // 中山公园附近
    ];

    // const material = new THREE.MeshBasicMaterial({ color: 0x0077ff, transparent: true, opacity: 0.8 }); // 旧代码
    const colors = [0xff0000, 0x00ff00, 0x0000ff, 0xffff00, 0x00ffff, 0xff00ff]; // 示例颜色数组


    buildingData.forEach(data => {
        const randomColor = colors[Math.floor(Math.random() * colors.length)];
        const material = new THREE.MeshStandardMaterial({
            color: randomColor,
            metalness: 0.7,   // 金属感
            roughness: 0.3,  // 粗糙度
            transparent: true, // 如果需要透明效果
            opacity: 0.9       // 透明度
        });

        // **重要：将经纬度转换为Three.js场景中的坐标**
        // 高德地图的CustomLayer会自动处理坐标转换，我们提供的经纬度会被正确映射
        // 但是，Three.js中的物体大小（size）需要我们根据实际尺度和地图缩放级别进行调整
        // 这里我们暂时使用固定的size，后续需要更精确的转换逻辑

        // AMap.LngLat对象用于表示经纬度
        const lngLat = new AMap.LngLat(data.position[0], data.position[1]);

        // 创建立方体
        const geometry = new THREE.BoxGeometry(data.size[0], data.size[1], data.size[2]);
        const mesh = new THREE.Mesh(geometry, material);

        // **设置物体在高德地图上的位置**
        // CustomLayer要求我们使用setExtraData方法将Three.js对象与LngLat关联
        // 并且需要将物体添加到scene中后，调用 customLayer.render() 来更新
        // 或者，更简单的方式是，CustomLayer的渲染回调 onThreeJSRender 内部会处理同步
        // 我们只需要确保物体在scene中，并且其位置通过某种方式与地理坐标关联

        // **定位建筑物**
        // 对于CustomLayer，我们通常不直接设置Three.js对象的position属性为经纬度。
        // CustomLayer的强大之处在于它负责将整个Three.js场景根据地图视图进行变换。
        // 我们在Three.js场景中放置物体时，可以认为场景的原点(0,0,0)对应于某个地理参考点，
        // 或者，更常见的做法是，直接在高德地图的`onThreeJSRender`中，根据每个建筑物的真实经纬度计算其相对于当前地图中心点的偏移，
        // 然后设置其在Three.js场景中的位置。

        // **简化的方法：让CustomLayer处理**
        // 如果我们直接将物体添加到(0,0,0)或者某个固定的Three.js坐标，CustomLayer会将其视为相对于地图初始中心点。
        // 要精确放置，我们需要在onThreeJSRender中根据每个物体的经纬度计算其在当前视图下的模型矩阵。

        // **更推荐的做法：使用高德地图的 `map.lngLatToGeodeticCoord` 或 `map.lngLatToContainer`**
        // 配合 `map.getCenter()` 来计算每个物体相对于地图中心点的三维坐标。

        // 暂时，我们将建筑物添加到场景中，并让CustomLayer的默认变换处理。
        // 为了让它们出现在正确的高度，我们设置z轴（在Three.js中通常是y轴向上，但高德地图的3D视图可能不同）
        // 高德地图3D视图中，物体的高度通常是其z值。
        // Three.js中，我们通常用y作为高度。这里需要匹配。
        // 假设高德地图CustomLayer的坐标系是 x-经度方向, y-纬度方向, z-高度。
        // 而Three.js默认是 x, y, z，通常y向上。
        // 我们需要调整模型或者在渲染时适配。

        // 为了简单起见，我们先将建筑物的中心放在(0,0,高度/2)的位置，
        // 然后依赖CustomLayer将整个场景根据地图视图进行平移和缩放。
        // 实际的经纬度定位需要更复杂的处理，在onThreeJSRender中进行。

        // **临时简化定位：**
        // 我们将在 onThreeJSRender 中处理精确定位。
        // 现在，先将建筑物添加到场景中，并赋予它们经纬度属性，以便稍后使用。
        mesh.userData.lngLat = lngLat; // lngLat is an AMap.LngLat object.
        mesh.userData.height = data.size[2]; // Store building height from size[2].

        // 由于CustomLayer负责整体场景的变换，我们先将建筑物放置在Three.js场景的特定位置。
        // 这里的 (0,0,0) 实际上会被CustomLayer转换。
        // 我们需要一种方法将地理坐标转换为Three.js场景中的相对坐标。
        // AMap.CustomLayer会自动将 (0,0,0) 对应到地图的某个固定点（通常是初始中心）。
        // 我们需要将每个建筑物的经纬度转换为相对于这个固定点的偏移。

        // 使用 `map.lngLatToGeodeticCoord` 将经纬度转换为一个平面坐标（非屏幕坐标）
        // 这个坐标可以作为Three.js中的x和y。z是高度。
        // 注意：getCenter() 返回的是LngLat对象。
        const centerLngLat = map.getCenter();
        const centerWebMercator = map.lngLatToGeodesicLngLat(centerLngLat); // 或者其他合适的转换
        const buildingWebMercator = map.lngLatToGeodesicLngLat(lngLat);

        // 计算偏移量 (这只是一个示例，实际转换可能更复杂或使用内置函数)
        // 这些偏移是在一个平面上的，单位可能是米
        const positionX = (buildingWebMercator.getLng() - centerWebMercator.getLng());
        const positionY = (buildingWebMercator.getLat() - centerWebMercator.getLat());


        // **重要调整**：高德地图 CustomLayer 的工作方式是，它提供 viewMatrix 和 projectionMatrix。
        // 我们应该将 Three.js 的物体放置在相对于某个 *固定* 的 Three.js 世界原点。
        // 然后，整个场景会被这两个矩阵变换。
        // 因此，我们需要将所有建筑物的经纬度转换成相对于同一个 Three.js 原点的坐标。
        // 一个常用的方法是，选择一个参考点（比如第一个建筑物的经纬度，或者地图初始中心），
        // 将其作为 Three.js 场景的 (0,0,0)。然后其他所有建筑物的经纬度都转换为相对于这个参考点的米级偏移。

        // **最直接的方法，依赖高德地图的转换能力：**
        // 我们在创建物体时，将其放置在 (0,0,0) 或者说其局部坐标系的原点。
        // 然后在 onThreeJSRender 中，为每个物体计算其单独的模型矩阵，
        // 这个模型矩阵将经纬度转换到高德地图的视图空间，然后再乘以视图和投影矩阵。
        // 或者，更简单地，让 CustomLayer 处理整个场景的平移。
        // 我们只需将建筑物添加到场景中，并确保其高度正确。

        // **修正：** CustomLayer 会将整个 Three.js 场景作为一个整体进行变换。
        // 我们需要将所有建筑物的经纬度转换为相对于 *同一个* Three.js 场景原点的坐标。
        // 步骤：
        // 1. 选择一个参考点 (e.g., map.getCenter() at init time or a fixed LngLat).
        // 2. For each building, convert its LngLat to meters offset from this reference point.
        // 3. Use these meter offsets as x, y coordinates in Three.js. z will be height.

        // For now, let's add buildings to the scene.
        // Their exact positioning relative to the map will be handled by the CustomLayer's render function
        // by setting up the main camera correctly.
        // We will position the buildings relative to a common origin in Three.js world space.
        // Let's use the map's initial center as the origin for the Three.js scene.
        // We need a utility function to convert LngLat to Three.js world coordinates.

        // Let's defer precise positioning to the "Refine Building Representation" step.
        // For now, add them to the scene at arbitrary positions to verify they render.
        // The CustomLayer will place the renderer.domElement correctly.
        // The camera sync will handle the view.

        // To make buildings appear at their specified LngLat, we need to set their positions
        // in the Three.js world space such that they align with the map after the CustomLayer's transformation.
        // A common approach is to use the `map.lngLatToGlScale` and `map.lngLatToGlCenter` (if available)
        // or calculate offsets manually.

        // **Simplification for initial setup:**
        // The `AMap.CustomLayer` combined with `map.getViewMatrixAndProjectionMatrix()`
        // means we can position objects in our Three.js scene using *world coordinates* that
        // are effectively meter offsets from some origin. The Gaode API handles the complex
        // geo-to-screen transformation via the matrices.
        // The key is to establish a consistent mapping.
        // Let's place the first building at the Three.js origin (0,0,0) + its height.
        // And other buildings relative to it using meter offsets if we had them.
        // Since we only have LngLat, we need a conversion.

        // **Using `data.position` directly as an approximation for now, assuming CustomLayer handles it.**
        // This is NOT metrically accurate yet. It's for testing the rendering pipeline.
        // The Z coordinate will be half the height to place the base on the ground.
        // We will need to adjust the X and Y based on a proper LngLat to world space conversion.
        // For now, let's use a simplified approach where the CustomLayer handles the scene's center.
        // We will place objects near the origin of the Three.js scene.

        // The `map.lngLatToGeodeticCoord` or similar methods are what we need.
        // `customLayer.lngLatToPosition(lngLat)` is also a candidate if available in API v2.

        // Let's assume for now that the CustomLayer places the (0,0,0) of the Three.js scene
        // at the current map center. We then need to position buildings relative to this center.
        // This means in onThreeJSRender, we'd update positions if the map center changes.

        // **Revised approach for addSampleBuildings:**
        // We will store LngLat and create meshes.
        // In `onThreeJSRender`, we will calculate their world positions based on current map view.
        const position = map.lngLatToContainer(lngLat); // Get screen coordinates
        // This isn't quite right for world position. We need something like lngLatToWorld.
        // AMap.Pixel has .getX() .getY()

        // Let's use a fixed origin for the Three.js scene for now, and place buildings relative to it.
        // This fixed origin will be translated and scaled by the CustomLayer.
        // We need to convert all building LngLats to meter offsets from this common origin.

        // For the first pass, let's just add them to the scene and see.
        // The BoxGeometry takes (width, height, depth).
        // data.size is [widthOnMap, depthOnMap, heightOfBuilding]
        // So, data.size[0] is width, data.size[2] is height, data.size[1] is depth for the geometry.
        const buildingGeometry = new THREE.BoxGeometry(data.size[0], data.size[2], data.size[1]);
        const buildingMesh = new THREE.Mesh(buildingGeometry, material);

        // Store LngLat (AMap.LngLat object) and height (meters) in userData for use in onThreeJSRender.
        // mesh.userData.lngLat = lngLat; // This was already assigned above where lngLat is created.
        // mesh.userData.height = data.size[2]; // This was already assigned above.

        // Set initial position. This will be updated in onThreeJSRender to the precise geo-referenced location.
        // Centering the base of the building at (0,0,0) in its local coordinates, then raising by half height.
        buildingMesh.position.set(0, data.size[2] / 2, 0);

        scene.add(buildingMesh);
        buildingMeshes.push(buildingMesh); // Keep track of meshes
    });

    // After adding, we need to tell CustomLayer to re-render if it doesn't automatically.
    // map.render(); // or customLayer.render();
    // This should be handled by the viewchange event or initial load.
}

// Placeholder for animation loop if needed for non-map-driven animations
// function animate() {
//     requestAnimationFrame(animate);
//     // Add any Three.js animations here that are independent of map view changes
//     // renderer.render(scene, camera); // This is handled by onThreeJSRender for map sync
// }

// Adjust renderer size on window resize
window.addEventListener('resize', () => {
    if (camera && renderer) {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
        if (customLayer) {
            customLayer.render(); // Re-render on resize
        }
    }
});

// Initialize everything
initGaodeMap();

// **Further refinement for building positioning in onThreeJSRender:**
// Inside onThreeJSRender, after setting camera matrices:
// buildingMeshes.forEach(mesh => {
//     const lngLat = mesh.userData.lngLat;
//     // Convert lngLat to current view's GL coordinates
//     // This is the most complex part: mapping geo-coordinates to the 3D world space
//     // that is being viewed by the synchronized camera.
//     // Gaode Maps API might provide utilities for this.
//     // For example, map.lngLatToView(lngLat) or similar.
//     // Or, we calculate offset from map center in meters, then transform.
//
//     // Example: (needs actual Gaode API calls for conversion)
//     // const worldPos = convertLngLatToWorld(lngLat, map.getCenter());
//     // mesh.position.set(worldPos.x, mesh.userData.height / 2, worldPos.y); // Assuming y is lat, x is lng, z is up for position
//     // mesh.lookAt(camera.position); // Optional: make buildings face camera or a fixed point
// });
// renderer.render(scene, camera); // Ensure this is called after updates
