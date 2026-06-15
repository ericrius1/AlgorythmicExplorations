import bpy
import math
from mathutils import Vector


TAU = math.tau
LOOP_END = 241
OUT_DIR = "/Users/eric/codeprojects/AlgorythmicExplorations"


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for datablocks in (
        bpy.data.curves,
        bpy.data.meshes,
        bpy.data.materials,
        bpy.data.cameras,
        bpy.data.lights,
    ):
        for block in list(datablocks):
            if block.users == 0:
                datablocks.remove(block)


def smooth_object(obj):
    if obj.type == "MESH":
        for poly in obj.data.polygons:
            poly.use_smooth = True


def add_bevel(obj, width=0.08, segments=3):
    mod = obj.modifiers.new("Soft bevel", "BEVEL")
    mod.width = width
    mod.segments = segments


def material(name, base, metallic=0.0, roughness=0.45, emission=None, emission_strength=0.0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*base, 1.0)
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    if emission:
        emission_input = bsdf.inputs.get("Emission Color") or bsdf.inputs.get("Emission")
        strength_input = bsdf.inputs.get("Emission Strength")
        if emission_input:
            emission_input.default_value = (*emission, 1.0)
        if strength_input:
            strength_input.default_value = emission_strength
    return mat


def glass_material(name, color):
    mat = material(name, color, metallic=0.05, roughness=0.12)
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    transmission = bsdf.inputs.get("Transmission Weight") or bsdf.inputs.get("Transmission")
    if transmission:
        transmission.default_value = 0.72
    coat = bsdf.inputs.get("Coat Weight") or bsdf.inputs.get("Clearcoat")
    if coat:
        coat.default_value = 0.55
    return mat


def assign(obj, mat):
    obj.data.materials.append(mat)


def add_driver(target, data_path, index, expression, controller):
    fcurve = target.driver_add(data_path, index)
    driver = fcurve.driver
    driver.type = "SCRIPTED"
    driver.expression = expression
    var = driver.variables.new()
    var.name = "phase"
    var.type = "SINGLE_PROP"
    var.targets[0].id = controller
    var.targets[0].data_path = '["phase"]'
    return fcurve


def add_cylinder(name, radius, depth, z, mat, vertices=96):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=(0, 0, z))
    obj = bpy.context.object
    obj.name = name
    assign(obj, mat)
    add_bevel(obj, min(depth * 0.18, 0.14), 4)
    smooth_object(obj)
    return obj


def add_uv_sphere(name, location, scale, mat, segments=64, rings=32):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=rings, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    assign(obj, mat)
    smooth_object(obj)
    return obj


def add_ico(name, location, radius, subdivisions, mat):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=subdivisions, radius=radius, location=location)
    obj = bpy.context.object
    obj.name = name
    assign(obj, mat)
    smooth_object(obj)
    return obj


def add_torus(name, location, major_radius, minor_radius, rotation, mat):
    bpy.ops.mesh.primitive_torus_add(
        major_radius=major_radius,
        minor_radius=minor_radius,
        major_segments=128,
        minor_segments=20,
        location=location,
        rotation=rotation,
    )
    obj = bpy.context.object
    obj.name = name
    assign(obj, mat)
    smooth_object(obj)
    return obj


def make_curve(name, points, bevel, mat, cyclic=False, resolution=3):
    curve = bpy.data.curves.new(name, "CURVE")
    curve.dimensions = "3D"
    curve.resolution_u = resolution
    curve.bevel_depth = bevel
    curve.bevel_resolution = 4
    spline = curve.splines.new("NURBS")
    spline.points.add(len(points) - 1)
    for point, co in zip(spline.points, points):
        point.co = (*co, 1.0)
    spline.order_u = min(4, len(points))
    spline.use_endpoint_u = not cyclic
    spline.use_cyclic_u = cyclic
    obj = bpy.data.objects.new(name, curve)
    bpy.context.collection.objects.link(obj)
    assign(obj, mat)
    return obj


def leaf_mesh(name, length=1.0, width=0.45, thickness=0.05):
    verts = [
        (0.0, length, 0.0),
        (width, 0.15 * length, 0.05),
        (0.0, -length, 0.0),
        (-width, 0.15 * length, 0.05),
        (0.0, 0.0, thickness),
        (0.0, 0.0, -thickness),
    ]
    faces = [
        (0, 1, 4),
        (1, 2, 4),
        (2, 3, 4),
        (3, 0, 4),
        (1, 0, 5),
        (2, 1, 5),
        (3, 2, 5),
        (0, 3, 5),
    ]
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    return mesh


def add_leaf(name, location, rotation, scale, mat, mesh=None):
    mesh = mesh or leaf_mesh(name + "_mesh")
    obj = bpy.data.objects.new(name, mesh.copy())
    bpy.context.collection.objects.link(obj)
    obj.location = location
    obj.rotation_euler = rotation
    obj.scale = scale
    assign(obj, mat)
    add_bevel(obj, 0.04, 3)
    smooth_object(obj)
    return obj


def look_at(obj, point):
    direction = Vector(point) - obj.location
    obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def add_area_light(name, location, energy, color, size, target=(0, 0, 3)):
    data = bpy.data.lights.new(name, "AREA")
    data.energy = energy
    data.color = color
    data.shape = "DISK"
    data.size = size
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    obj.location = location
    look_at(obj, target)
    return obj


clear_scene()

# Materials
stone = material("Reclaimed limestone", (0.16, 0.22, 0.18), roughness=0.72)
stone_light = material("Sun-washed stone", (0.34, 0.42, 0.32), roughness=0.62)
bronze = material("Living bronze", (0.36, 0.14, 0.035), metallic=0.88, roughness=0.25)
gold = material("Solar gold", (0.95, 0.43, 0.035), metallic=0.72, roughness=0.22)
moss = material("Moss green", (0.025, 0.26, 0.075), roughness=0.68)
leaf_green = material("Leaf enamel", (0.015, 0.48, 0.16), metallic=0.18, roughness=0.28)
deep_green = material("Deep vine", (0.008, 0.11, 0.045), metallic=0.35, roughness=0.28)
solar_blue = glass_material("Photovoltaic teal", (0.015, 0.34, 0.39))
glass = glass_material("Bio glass", (0.08, 0.72, 0.48))
sun_mat = material(
    "Sun seed emission",
    (1.0, 0.18, 0.015),
    metallic=0.1,
    roughness=0.18,
    emission=(1.0, 0.08, 0.005),
    emission_strength=7.0,
)
energy_mat = material(
    "Energy filament",
    (0.05, 0.55, 0.2),
    metallic=0.05,
    roughness=0.2,
    emission=(0.02, 1.0, 0.24),
    emission_strength=4.0,
)
warm_light_mat = material(
    "Warm nodes",
    (1.0, 0.32, 0.02),
    roughness=0.18,
    emission=(1.0, 0.12, 0.01),
    emission_strength=5.0,
)

# Loop controller
controller = bpy.data.objects.new("Loop_Controller", None)
bpy.context.collection.objects.link(controller)
controller.empty_display_type = "CIRCLE"
controller.empty_display_size = 1.4
controller["phase"] = 0.0
phase_driver = controller.driver_add('["phase"]').driver
phase_driver.type = "SCRIPTED"
phase_driver.expression = "(frame-1)*1.5"

# Ground and terraced pedestal
add_cylinder("Garden plinth", 8.5, 0.35, -0.28, stone, 128)
add_cylinder("Terrace lower", 5.7, 0.55, 0.12, stone_light, 128)
add_cylinder("Terrace moss", 5.25, 0.16, 0.47, moss, 128)
add_cylinder("Terrace upper", 4.35, 0.48, 0.64, stone, 128)
add_cylinder("Inner garden", 3.82, 0.13, 0.94, moss, 128)
add_cylinder("Sculpture socket", 2.15, 0.48, 1.14, bronze, 128)

# Concentric inlaid energy channels.
for i, radius in enumerate((2.48, 3.25, 4.55, 5.55)):
    ring = add_torus(
        f"Ground energy ring {i + 1}",
        (0, 0, 1.03 if i < 2 else 0.62),
        radius,
        0.025 + i * 0.008,
        (0, 0, 0),
        energy_mat if i % 2 == 0 else gold,
    )
    add_driver(ring, "rotation_euler", 2, f"phase*0.017453292519943295*{i + 1}", controller)

# Braided living-vine tower.
vine_rigs = []
for strand in range(3):
    rig = bpy.data.objects.new(f"Vine_Rig_{strand + 1}", None)
    bpy.context.collection.objects.link(rig)
    vine_rigs.append(rig)
    points = []
    for j in range(145):
        t = j / 144
        ang = TAU * (3.15 * t + strand / 3)
        radius = 1.18 - 0.38 * t + 0.12 * math.sin(TAU * t * 2)
        points.append((radius * math.cos(ang), radius * math.sin(ang), 1.35 + 5.35 * t))
    vine = make_curve(f"Living vine {strand + 1}", points, 0.13, deep_green)
    vine.parent = rig
    speed = (1, -1, 2)[strand]
    add_driver(rig, "rotation_euler", 2, f"phase*0.017453292519943295*{speed}", controller)

# Fine luminous filaments woven through the trunk.
for strand in range(3):
    points = []
    for j in range(160):
        t = j / 159
        ang = TAU * (4.2 * t + strand / 3)
        radius = 0.72 + 0.16 * math.sin(TAU * t * 3 + strand)
        points.append((radius * math.cos(ang), radius * math.sin(ang), 1.35 + 5.5 * t))
    filament = make_curve(f"Energy filament {strand + 1}", points, 0.028, energy_mat)
    filament.parent = vine_rigs[strand]

# Leaves climbing the tower.
small_leaf_mesh = leaf_mesh("Climbing leaf source", 0.48, 0.23, 0.035)
for i in range(30):
    t = (i + 0.8) / 31
    strand = i % 3
    ang = TAU * (3.15 * t + strand / 3)
    radius = 1.35 - 0.32 * t
    loc = (radius * math.cos(ang), radius * math.sin(ang), 1.5 + 5.1 * t)
    leaf = add_leaf(
        f"Climbing leaf {i + 1:02d}",
        loc,
        (0.35 * math.sin(ang), 0.5, ang - math.pi / 2),
        (0.75 + 0.28 * t, 0.75 + 0.28 * t, 0.75),
        leaf_green if i % 3 else gold,
        small_leaf_mesh,
    )
    leaf.parent = vine_rigs[strand]
    leaf["base_tilt"] = leaf.rotation_euler.x
    expr = f"{leaf.rotation_euler.x:.6f}+0.16*sin(phase*0.03490658503988659+{i * 0.73:.6f})"
    add_driver(leaf, "rotation_euler", 0, expr, controller)

# Suspended sun seed and internal core.
seed_rig = bpy.data.objects.new("Sun_Seed_Rig", None)
bpy.context.collection.objects.link(seed_rig)
seed = add_ico("Sun seed", (0, 0, 6.95), 0.82, 5, sun_mat)
seed.parent = seed_rig
seed_inner = add_uv_sphere("Sun seed glass core", (0, 0, 6.95), (1.13, 1.13, 1.13), glass)
seed_inner.parent = seed_rig
add_driver(seed_rig, "scale", 0, "1+0.055*sin(phase*0.03490658503988659)", controller)
add_driver(seed_rig, "scale", 1, "1+0.055*sin(phase*0.03490658503988659)", controller)
add_driver(seed_rig, "scale", 2, "1+0.055*sin(phase*0.03490658503988659)", controller)
add_driver(seed_rig, "rotation_euler", 2, "phase*0.017453292519943295", controller)

# Kinetic halo armature.
halo_specs = [
    (2.05, 0.075, (math.radians(68), 0, math.radians(18)), gold, 1),
    (2.42, 0.055, (math.radians(48), math.radians(38), 0), bronze, -1),
    (2.82, 0.036, (math.radians(82), math.radians(-22), math.radians(45)), energy_mat, 2),
]
for i, (radius, thickness, rot, mat, speed) in enumerate(halo_specs):
    halo = add_torus(f"Kinetic halo {i + 1}", (0, 0, 6.95), radius, thickness, rot, mat)
    add_driver(halo, "rotation_euler", i % 3, f"{rot[i % 3]:.6f}+phase*0.017453292519943295*{speed}", controller)

# Solar canopy: gold-backed photovoltaic leaf collectors.
canopy_rig = bpy.data.objects.new("Solar_Canopy_Rig", None)
bpy.context.collection.objects.link(canopy_rig)
add_driver(canopy_rig, "rotation_euler", 2, "phase*0.017453292519943295", controller)
solar_leaf_mesh = leaf_mesh("Solar leaf source", 1.45, 0.7, 0.07)
for i in range(12):
    ang = TAU * i / 12
    radius = 3.45 + 0.22 * math.sin(i * 2.1)
    z = 6.45 + 0.48 * math.sin(ang * 2)
    loc = (radius * math.cos(ang), radius * math.sin(ang), z)
    rot = (math.radians(17 + 7 * math.sin(ang)), math.radians(17), ang - math.pi / 2)
    back = add_leaf(
        f"Solar petal frame {i + 1:02d}",
        loc,
        rot,
        (1.12, 1.12, 1.0),
        gold,
        solar_leaf_mesh,
    )
    back.parent = canopy_rig
    panel = add_leaf(
        f"Solar petal panel {i + 1:02d}",
        (loc[0], loc[1], loc[2] + 0.055),
        rot,
        (0.88, 0.88, 0.58),
        solar_blue,
        solar_leaf_mesh,
    )
    panel.parent = canopy_rig
    expr = f"{rot[0]:.6f}+0.13*sin(phase*0.03490658503988659+{i * TAU / 12:.6f})"
    add_driver(back, "rotation_euler", 0, expr, controller)
    add_driver(panel, "rotation_euler", 0, expr, controller)

# Orbiting seed pods.
pod_rig = bpy.data.objects.new("Orbiting_Seed_Pods", None)
bpy.context.collection.objects.link(pod_rig)
add_driver(pod_rig, "rotation_euler", 2, "-phase*0.017453292519943295", controller)
for i in range(8):
    ang = TAU * i / 8
    radius = 4.7
    z = 4.2 + 0.55 * math.sin(ang * 2)
    pod = add_ico(
        f"Luminous seed pod {i + 1:02d}",
        (radius * math.cos(ang), radius * math.sin(ang), z),
        0.18 + 0.035 * (i % 3),
        3,
        warm_light_mat if i % 2 else energy_mat,
    )
    pod.parent = pod_rig
    add_driver(pod, "scale", 0, f"1+0.25*sin(phase*0.03490658503988659+{i:.6f})", controller)
    add_driver(pod, "scale", 1, f"1+0.25*sin(phase*0.03490658503988659+{i:.6f})", controller)
    add_driver(pod, "scale", 2, f"1+0.25*sin(phase*0.03490658503988659+{i:.6f})", controller)

# Lower garden fronds.
garden_leaf_mesh = leaf_mesh("Garden frond source", 1.1, 0.42, 0.05)
for i in range(18):
    ang = TAU * i / 18 + 0.16 * math.sin(i)
    radius = 3.0 + 0.65 * (i % 3) / 2
    leaf = add_leaf(
        f"Garden frond {i + 1:02d}",
        (radius * math.cos(ang), radius * math.sin(ang), 1.05),
        (math.radians(56), math.radians(12 * math.sin(i)), ang - math.pi / 2),
        (0.75 + 0.15 * (i % 3), 0.75 + 0.15 * (i % 3), 1.0),
        leaf_green if i % 4 else gold,
        garden_leaf_mesh,
    )
    add_driver(
        leaf,
        "rotation_euler",
        0,
        f"{leaf.rotation_euler.x:.6f}+0.10*sin(phase*0.017453292519943295+{i * 0.55:.6f})",
        controller,
    )

# Lighting
world = bpy.context.scene.world or bpy.data.worlds.new("World")
bpy.context.scene.world = world
world.use_nodes = True
world_bg = world.node_tree.nodes.get("Background")
world_bg.inputs["Color"].default_value = (0.008, 0.018, 0.014, 1.0)
world_bg.inputs["Strength"].default_value = 0.18

add_area_light("Warm key", (6.5, -6.0, 11.0), 1500, (1.0, 0.38, 0.12), 5.0, (0, 0, 4.0))
add_area_light("Cool fill", (-7.0, -3.5, 7.0), 1100, (0.08, 0.42, 1.0), 5.0, (0, 0, 4.0))
add_area_light("Green rim", (1.0, 6.5, 8.5), 1300, (0.06, 1.0, 0.33), 4.0, (0, 0, 4.5))
add_area_light("Plinth wash", (0.0, 0.0, 12.0), 900, (1.0, 0.72, 0.35), 3.5, (0, 0, 0.5))

point_data = bpy.data.lights.new("Sun seed point", "POINT")
point_data.energy = 720
point_data.color = (1.0, 0.16, 0.025)
point_data.shadow_soft_size = 2.2
point_obj = bpy.data.objects.new("Sun seed point", point_data)
bpy.context.collection.objects.link(point_obj)
point_obj.location = (0, 0, 6.95)

# Camera
cam_data = bpy.data.cameras.new("Sculpture_Camera")
camera = bpy.data.objects.new("Sculpture_Camera", cam_data)
bpy.context.collection.objects.link(camera)
camera.location = (12.4, -14.2, 9.5)
cam_data.lens = 57
cam_data.sensor_width = 36
look_at(camera, (0, 0, 4.0))
bpy.context.scene.camera = camera

# Render and color management
scene = bpy.context.scene
scene.frame_start = 1
scene.frame_end = 240
scene.render.engine = "BLENDER_EEVEE"
scene.render.resolution_x = 720
scene.render.resolution_y = 720
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "PNG"
scene.render.film_transparent = False
scene.render.fps = 30
scene.render.filepath = OUT_DIR + "/solarpunk_loop_"
scene.render.image_settings.color_mode = "RGBA"
scene.render.image_settings.color_depth = "8"
scene.render.resolution_percentage = 100
scene.view_settings.look = "AgX - Medium High Contrast"

scene.frame_set(1)
bpy.ops.wm.save_as_mainfile(filepath=OUT_DIR + "/solarpunk_loop_sculpture.blend")
print(f"Created {len(bpy.context.scene.objects)} objects and saved solarpunk_loop_sculpture.blend")
