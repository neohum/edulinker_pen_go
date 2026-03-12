<script lang="ts">
    import { onMount, onDestroy } from "svelte";
    import * as THREE from "three";
    import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

    let canvasRef: HTMLCanvasElement;
    let requestID: number;

    // Three.js basic setup
    let scene: THREE.Scene;
    let camera: THREE.PerspectiveCamera;
    let renderer: THREE.WebGLRenderer;
    let loader = new GLTFLoader();

    // Cache to avoid reloading the same GLB multiple times
    const modelCache = new Map<string, THREE.Group>();

    // Use Vite's import.meta.glob with eager + url to get resolved asset URLs
    // The path is relative to THIS file (ActionEffects.svelte is in src/)
    const glbModules: Record<string, string> = import.meta.glob(
        "./assets/images/3D/*.glb",
        { eager: true, as: "url" },
    );
    const glbPaths = Object.values(glbModules);
    console.log("[ActionEffects] GLB paths found:", glbPaths.length, glbPaths);

    // Define physical object state
    interface FloatingItem {
        mesh: THREE.Group;
        vx: number;
        vy: number;
        vz: number;
        rx: number;
        ry: number;
        rz: number;
        scaleTarget: number;
        life: number;
        maxLife: number;
    }

    let activeItems: FloatingItem[] = [];

    onMount(() => {
        initThreeJS();
        window.addEventListener("resize", handleResize);
        animate();
        console.log("[ActionEffects] Mounted, renderer ready");
    });

    onDestroy(() => {
        window.removeEventListener("resize", handleResize);
        cancelAnimationFrame(requestID);
        if (renderer) renderer.dispose();
    });

    function initThreeJS() {
        scene = new THREE.Scene();

        // Pixel-perfect perspective camera formulation
        const fov = 45;
        camera = new THREE.PerspectiveCamera(
            fov,
            window.innerWidth / window.innerHeight,
            0.1,
            5000,
        );
        updateCameraZ();

        renderer = new THREE.WebGLRenderer({
            canvas: canvasRef,
            alpha: true, // transparent background
            antialias: true,
        });
        renderer.setSize(window.innerWidth, window.innerHeight);
        renderer.setPixelRatio(window.devicePixelRatio);
        renderer.setClearColor(0x000000, 0); // fully transparent

        // Lights - strong so models are always visible
        const ambientLight = new THREE.AmbientLight(0xffffff, 1.0);
        scene.add(ambientLight);

        const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
        dirLight.position.set(100, 200, 300);
        scene.add(dirLight);

        const dirLight2 = new THREE.DirectionalLight(0xffeedd, 0.6);
        dirLight2.position.set(-100, -200, -100);
        scene.add(dirLight2);

        // Quick test: Add a small visible sphere to verify the canvas renders at all
        const testGeo = new THREE.SphereGeometry(5, 16, 16);
        const testMat = new THREE.MeshBasicMaterial({ color: 0xff0000 });
        const testMesh = new THREE.Mesh(testGeo, testMat);
        testMesh.position.set(0, 0, 0);
        scene.add(testMesh);
        console.log("[ActionEffects] Test sphere added at origin");

        // Remove after 2 seconds
        setTimeout(() => {
            scene.remove(testMesh);
        }, 2000);
    }

    function updateCameraZ() {
        if (!camera) return;
        // Position camera so that 1 unit in Z=0 plane equals 1 pixel on screen
        camera.position.z =
            window.innerHeight / 2 / Math.tan((Math.PI * camera.fov) / 360);
        camera.updateProjectionMatrix();
    }

    function handleResize() {
        if (!camera || !renderer) return;
        camera.aspect = window.innerWidth / window.innerHeight;
        updateCameraZ();
        renderer.setSize(window.innerWidth, window.innerHeight);
    }

    // EXPORTED FUNCTION: Call this from App.svelte when the action pen is dragged
    export function spawnObjectAt(clientX: number, clientY: number) {
        console.log(
            "[ActionEffects] spawnObjectAt called:",
            clientX,
            clientY,
            "glbPaths:",
            glbPaths.length,
        );

        if (glbPaths.length === 0) {
            console.error(
                "[ActionEffects] No GLB paths found! Cannot spawn 3D objects.",
            );
            // Fallback: spawn a colored cube instead
            spawnFallbackCube(clientX, clientY);
            return;
        }

        // Pick a random model
        const randIndex = Math.floor(Math.random() * glbPaths.length);
        const url = glbPaths[randIndex];

        // Convert screen coordinates to world coordinates (z=0)
        const worldX = clientX - window.innerWidth / 2;
        const worldY = -(clientY - window.innerHeight / 2);

        if (modelCache.has(url)) {
            // Clone from cache
            const prototype = modelCache.get(url)!;
            createFallingInstance(prototype, worldX, worldY);
        } else {
            // Load and cache
            console.log("[ActionEffects] Loading GLB:", url);
            loader.load(
                url,
                (gltf) => {
                    const model = gltf.scene;

                    // Normalize size: measure bounding box and scale to 1 unit
                    const box = new THREE.Box3().setFromObject(model);
                    const size = box.getSize(new THREE.Vector3());
                    console.log(
                        `[ActionEffects] Loaded ${url}, Size: ${size.x.toFixed(2)}x${size.y.toFixed(2)}x${size.z.toFixed(2)}`,
                    );

                    const maxDim = Math.max(size.x, size.y, size.z);
                    if (maxDim > 0) {
                        const s = 1.0 / maxDim;
                        model.scale.set(s, s, s);
                    }

                    // Cache the original
                    modelCache.set(url, model.clone());

                    createFallingInstance(model, worldX, worldY);
                },
                undefined,
                (error) => {
                    console.error("[ActionEffects] Error loading GLB:", error);
                    // Fallback to cube if GLB fails
                    spawnFallbackCube(clientX, clientY);
                },
            );
        }
    }

    // Fallback: spawn a simple colored cube when GLBs are unavailable
    function spawnFallbackCube(clientX: number, clientY: number) {
        const worldX = clientX - window.innerWidth / 2;
        const worldY = -(clientY - window.innerHeight / 2);

        const colors = [
            0xff6b6b, 0xffa502, 0x2ed573, 0x1e90ff, 0xeccc68, 0xa29bfe,
            0xfd79a8,
        ];
        const color = colors[Math.floor(Math.random() * colors.length)];
        const geo = new THREE.BoxGeometry(1, 1, 1);
        const mat = new THREE.MeshPhongMaterial({ color });
        const mesh = new THREE.Mesh(geo, mat);
        const group = new THREE.Group();
        group.add(mesh);
        group.position.set(worldX, worldY, 0);
        group.scale.set(0.01, 0.01, 0.01);
        group.rotation.set(
            Math.random() * Math.PI,
            Math.random() * Math.PI,
            Math.random() * Math.PI,
        );
        scene.add(group);

        const targetScale = 20 + Math.random() * 15;
        const newItem: FloatingItem = {
            mesh: group,
            vx: (Math.random() - 0.5) * 6,
            vy: (Math.random() - 0.5) * 6 + 3,
            vz: (Math.random() - 0.5) * 3,
            rx: (Math.random() - 0.5) * 0.15,
            ry: (Math.random() - 0.5) * 0.15,
            rz: (Math.random() - 0.5) * 0.15,
            scaleTarget: targetScale,
            life: 0,
            maxLife: 120 + Math.random() * 60,
        };
        activeItems.push(newItem);
    }

    function createFallingInstance(
        baseModel: THREE.Group,
        x: number,
        y: number,
    ) {
        const instance = baseModel.clone();

        // Target scale: 30-50 pixels on screen
        const targetScale = 30 + Math.random() * 20;

        instance.position.set(x, y, 0);
        // Start tiny for POP effect
        instance.scale.set(0.01, 0.01, 0.01);

        // Random initial rotations
        instance.rotation.set(
            Math.random() * Math.PI,
            Math.random() * Math.PI,
            Math.random() * Math.PI,
        );

        scene.add(instance);

        const newItem: FloatingItem = {
            mesh: instance,
            vx: (Math.random() - 0.5) * 6, // Scatter horiz
            vy: (Math.random() - 0.5) * 6 + 3, // Slight upward bump
            vz: (Math.random() - 0.5) * 3, // Into/out of screen
            rx: (Math.random() - 0.5) * 0.15,
            ry: (Math.random() - 0.5) * 0.15,
            rz: (Math.random() - 0.5) * 0.15,
            scaleTarget: targetScale,
            life: 0,
            maxLife: 120 + Math.random() * 60, // Frames before disappearing
        };

        activeItems.push(newItem);
    }

    function animate() {
        requestID = requestAnimationFrame(animate);

        // Skip rendering entirely when no items - saves GPU for ink drawing
        if (activeItems.length === 0) {
            return;
        }

        // Physics / Animation loop
        for (let i = activeItems.length - 1; i >= 0; i--) {
            const item = activeItems[i];
            item.life++;

            // Pop-in scale animation (Spring-like)
            const curScale = item.mesh.scale.x;
            const diff = item.scaleTarget - curScale;
            if (item.life < 20) {
                // Quickly scale up
                const newScale = curScale + diff * 0.25;
                item.mesh.scale.set(newScale, newScale, newScale);
            } else if (item.life > item.maxLife - 20) {
                // Shrink before dying
                const shrinkScale = Math.max(0.01, curScale * 0.85);
                item.mesh.scale.set(shrinkScale, shrinkScale, shrinkScale);
            }

            // Apply velocities (Gravity effect + drag)
            item.mesh.position.x += item.vx;
            item.mesh.position.y += item.vy;
            item.mesh.position.z += item.vz;

            // Add a bit of downward gravity
            item.vy -= 0.12;

            // Air friction (drag)
            item.vx *= 0.98;
            item.vy *= 0.99;
            item.vz *= 0.98;

            // Apply rotations
            item.mesh.rotation.x += item.rx;
            item.mesh.rotation.y += item.ry;
            item.mesh.rotation.z += item.rz;

            // Remove if dead or fallen too far
            const halfHeight = window.innerHeight / 2;
            if (
                item.life >= item.maxLife ||
                item.mesh.position.y < -halfHeight - 200
            ) {
                scene.remove(item.mesh);
                activeItems.splice(i, 1);
            }
        }

        if (renderer && scene && camera) {
            renderer.render(scene, camera);
        }
    }
</script>

<canvas
    bind:this={canvasRef}
    class="absolute top-0 left-0 w-full h-full z-20 pointer-events-none touch-none"
></canvas>
