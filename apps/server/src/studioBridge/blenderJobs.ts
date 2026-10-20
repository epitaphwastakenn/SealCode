// @effect-diagnostics nodeBuiltinImport:off globalErrorInEffectCatch:off globalErrorInEffectFailure:off globalDateInEffect:off globalRandomInEffect:off globalTimers:off preferSchemaOverJson:off globalFetchInEffect:off -Blender runs as a headless child process on job folders.
import * as NodeChildProcess from "node:child_process";
import * as NodeFs from "node:fs";
import * as NodePath from "node:path";

import * as Effect from "effect/Effect";

/**
 * Headless Blender jobs. The agent's Python runs inside a prelude that gives it the job folder
 * and, afterwards, SealCode measures the result itself: a topology report for every mesh, an
 * optional preview render, and an optional OBJ export Studio can import.
 */

export interface BlenderJobResult {
  readonly ok: boolean;
  readonly exitCode: number | null;
  readonly timedOut: boolean;
  readonly jobDir: string;
  readonly output: string;
  readonly report: unknown;
  readonly files: ReadonlyArray<string>;
  readonly previewPng?: Buffer | undefined;
  readonly objPath?: string | undefined;
}

const PRELUDE = String.raw`
import bpy, bmesh, json, math, os, sys, traceback
from mathutils import Vector
JOB_DIR = os.environ["SEALCODE_JOB_DIR"]
if os.environ.get("SEALCODE_FRESH") == "1":
    # Start from nothing: no default cube, camera or light to clean up or export by mistake.
    bpy.ops.wm.read_homefile(use_empty=True)
def job_path(name):
    return os.path.join(JOB_DIR, name)
`;

// Runs after the agent's script, even when it failed part-way, so the report shows the state.
const EPILOGUE = String.raw`
def _sealcode_report():
    meshes = []
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH":
            continue
        me = obj.evaluated_get(bpy.context.evaluated_depsgraph_get()).to_mesh()
        bm = bmesh.new()
        bm.from_mesh(me)
        ngons = sum(1 for f in bm.faces if len(f.verts) > 4)
        quads = sum(1 for f in bm.faces if len(f.verts) == 4)
        tris = sum(len(f.verts) - 2 for f in bm.faces)
        non_manifold = sum(1 for e in bm.edges if not e.is_manifold and not e.is_boundary)
        boundary = sum(1 for e in bm.edges if e.is_boundary)
        loose_verts = sum(1 for v in bm.verts if not v.link_edges)
        loose_edges = sum(1 for e in bm.edges if not e.link_faces)
        zero_faces = sum(1 for f in bm.faces if f.calc_area() < 1e-8)
        dims = obj.dimensions
        meshes.append({
            "name": obj.name,
            "faces": len(bm.faces), "triangles": tris, "quads": quads, "ngons": ngons,
            "nonManifoldEdges": non_manifold, "openBoundaryEdges": boundary,
            "looseVerts": loose_verts, "looseEdges": loose_edges, "zeroAreaFaces": zero_faces,
            "materials": [s.material.name for s in obj.material_slots if s.material],
            "dimensions": [round(dims.x, 3), round(dims.y, 3), round(dims.z, 3)],
            "scaleApplied": all(abs(s - 1) < 1e-6 for s in obj.scale),
        })
        bm.free()
        obj.to_mesh_clear()
    return {"meshes": meshes, "totalTriangles": sum(m["triangles"] for m in meshes)}

def _sealcode_preview(path):
    objs = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    if not objs:
        return False
    lo = Vector((math.inf,) * 3); hi = Vector((-math.inf,) * 3)
    for o in objs:
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            lo = Vector(map(min, lo, w)); hi = Vector(map(max, hi, w))
    center = (lo + hi) / 2
    radius = max((hi - lo).length / 2, 0.01)
    cam_data = bpy.data.cameras.new("SealCodePreviewCam")
    cam = bpy.data.objects.new("SealCodePreviewCam", cam_data)
    bpy.context.scene.collection.objects.link(cam)
    direction = Vector((1.0, -1.2, 0.8)).normalized()
    cam.location = center + direction * radius * 3.2
    cam.rotation_euler = (center - cam.location).to_track_quat("-Z", "Y").to_euler()
    cam_data.clip_end = radius * 20
    scene = bpy.context.scene
    scene.camera = cam
    try:
        scene.render.engine = "BLENDER_WORKBENCH"
    except TypeError:
        pass
    try:
        scene.display.shading.light = "STUDIO"
        scene.display.shading.color_type = "MATERIAL"
        scene.display.shading.show_cavity = True
    except Exception:
        pass
    scene.render.resolution_x = 960
    scene.render.resolution_y = 720
    scene.render.film_transparent = False
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(cam, do_unlink=True)
    return True

def _sealcode_export(path):
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    if not meshes:
        return False
    bpy.ops.object.select_all(action="DESELECT")
    for o in meshes:
        o.select_set(True)
    kwargs = dict(filepath=path, export_selected_objects=True, export_materials=True, forward_axis="NEGATIVE_Z", up_axis="Y", export_triangulated_mesh=True)
    try:
        bpy.ops.wm.obj_export(**kwargs)
    except TypeError:
        kwargs.pop("export_triangulated_mesh", None)
        bpy.ops.wm.obj_export(**kwargs)
    return True

_status = {"scriptError": _sealcode_error}
try:
    _status["report"] = _sealcode_report()
except Exception as e:
    _status["reportError"] = str(e)
if os.environ.get("SEALCODE_PREVIEW") == "1":
    try:
        _status["preview"] = _sealcode_preview(job_path("preview.png"))
    except Exception as e:
        _status["previewError"] = str(e)
if os.environ.get("SEALCODE_EXPORT") == "1":
    try:
        _status["exported"] = _sealcode_export(job_path("model.obj"))
    except Exception as e:
        _status["exportError"] = str(e)
if os.environ.get("SEALCODE_SAVE_BLEND") == "1":
    try:
        bpy.ops.wm.save_as_mainfile(filepath=job_path("scene.blend"))
    except Exception as e:
        _status["saveError"] = str(e)
with open(job_path("sealcode-status.json"), "w") as f:
    json.dump(_status, f)
`;

/** The job script: prelude, the agent's file run with its own line numbers, then the measurements. */
export const buildJobScript = (agentScriptPath: string): string =>
  [
    PRELUDE,
    "_sealcode_error = None",
    "try:",
    `    _sealcode_path = ${JSON.stringify(agentScriptPath)}`,
    '    exec(compile(open(_sealcode_path, encoding="utf-8").read(), _sealcode_path, "exec"), globals())',
    "except Exception:",
    "    _sealcode_error = traceback.format_exc()[-4000:]",
    "    print(_sealcode_error, file=sys.stderr)",
    EPILOGUE,
  ].join("\n");

export const runBlenderJob = (input: {
  readonly executable: string;
  readonly jobsRoot: string;
  readonly script: string;
  readonly preview: boolean;
  readonly exportObj: boolean;
  readonly saveBlend: boolean;
  readonly timeoutMs: number;
  /** A .blend from an earlier job to continue from. */
  readonly openBlend?: string | undefined;
}) =>
  Effect.tryPromise({
    try: async (): Promise<BlenderJobResult> => {
      const id = `job-${new Date().toISOString().replace(/[:.]/gu, "-")}-${Math.random().toString(36).slice(2, 7)}`;
      const jobDir = NodePath.join(input.jobsRoot, id);
      NodeFs.mkdirSync(jobDir, { recursive: true });
      const agentPath = NodePath.join(jobDir, "agent.py");
      NodeFs.writeFileSync(agentPath, input.script);
      const scriptPath = NodePath.join(jobDir, "job.py");
      NodeFs.writeFileSync(scriptPath, buildJobScript(agentPath));
      const args = [
        ...(input.openBlend ? [input.openBlend] : []),
        "-b",
        ...(input.openBlend ? [] : ["--factory-startup"]),
        "--python",
        scriptPath,
      ];
      const output: string[] = [];
      let size = 0;
      const result = await new Promise<{ code: number | null; timedOut: boolean }>((resolve) => {
        const child = NodeChildProcess.spawn(input.executable, args, {
          cwd: jobDir,
          windowsHide: true,
          env: {
            ...process.env,
            SEALCODE_JOB_DIR: jobDir,
            SEALCODE_PREVIEW: input.preview ? "1" : "0",
            SEALCODE_EXPORT: input.exportObj ? "1" : "0",
            SEALCODE_SAVE_BLEND: input.saveBlend ? "1" : "0",
            SEALCODE_FRESH: input.openBlend ? "0" : "1",
          },
        });
        const collect = (chunk: Buffer) => {
          if (size > 400_000) return;
          size += chunk.length;
          output.push(chunk.toString("utf8"));
        };
        child.stdout.on("data", collect);
        child.stderr.on("data", collect);
        let timedOut = false;
        const timer = setTimeout(() => {
          timedOut = true;
          child.kill();
        }, input.timeoutMs);
        child.on("error", (error) => {
          output.push(String(error));
          clearTimeout(timer);
          resolve({ code: null, timedOut });
        });
        child.on("close", (code) => {
          clearTimeout(timer);
          resolve({ code, timedOut });
        });
      });
      let status: Record<string, unknown> = {};
      try {
        status = JSON.parse(
          NodeFs.readFileSync(NodePath.join(jobDir, "sealcode-status.json"), "utf8"),
        );
      } catch {
        status = { statusMissing: true };
      }
      // Blender's own banner and timing lines are noise for the model.
      const text = output
        .join("")
        .split(/\r?\n/u)
        .filter((line) => !/^(Blender \d|Read prefs|Fra:|Saved: |Time: |\s*$)/u.test(line))
        .join("\n");
      const previewPath = NodePath.join(jobDir, "preview.png");
      const objPath = NodePath.join(jobDir, "model.obj");
      return {
        ok: !result.timedOut && result.code === 0 && status.scriptError == null,
        exitCode: result.code,
        timedOut: result.timedOut,
        jobDir,
        output: text.length > 12_000 ? `…${text.slice(-12_000)}` : text,
        report: status,
        files: NodeFs.readdirSync(jobDir).filter(
          (name) => name !== "job.py" && name !== "sealcode-status.json",
        ),
        previewPng: NodeFs.existsSync(previewPath) ? NodeFs.readFileSync(previewPath) : undefined,
        objPath: NodeFs.existsSync(objPath) ? objPath : undefined,
      };
    },
    catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
  });

export interface MeshGroup {
  readonly name: string;
  readonly color: readonly [number, number, number];
  readonly vertices: ReadonlyArray<number>;
  readonly triangles: ReadonlyArray<number>;
}

/**
 * Reads an OBJ (+ its MTL diffuse colours) into one triangle list per material, with
 * positions in studs. Each group becomes one MeshPart in Studio.
 */
export const parseObj = (objText: string, mtlText: string | undefined, studsPerUnit: number) => {
  const colors = new Map<string, readonly [number, number, number]>();
  let currentMtl: string | undefined;
  for (const line of (mtlText ?? "").split(/\r?\n/u)) {
    const parts = line.trim().split(/\s+/u);
    if (parts[0] === "newmtl") currentMtl = parts.slice(1).join(" ");
    if (parts[0] === "Kd" && currentMtl !== undefined) {
      colors.set(currentMtl, [Number(parts[1]), Number(parts[2]), Number(parts[3])]);
    }
  }
  const positions: Array<readonly [number, number, number]> = [];
  const groups = new Map<
    string,
    { vertices: number[]; triangles: number[]; index: Map<number, number> }
  >();
  let material = "Default";
  for (const line of objText.split(/\r?\n/u)) {
    const parts = line.trim().split(/\s+/u);
    if (parts[0] === "v") {
      positions.push([
        Number(parts[1]) * studsPerUnit,
        Number(parts[2]) * studsPerUnit,
        Number(parts[3]) * studsPerUnit,
      ]);
    } else if (parts[0] === "usemtl") {
      material = parts.slice(1).join(" ") || "Default";
    } else if (parts[0] === "f") {
      let group = groups.get(material);
      if (group === undefined) {
        group = { vertices: [], triangles: [], index: new Map() };
        groups.set(material, group);
      }
      const ids = parts.slice(1).map((token) => {
        const raw = Number(token.split("/")[0]);
        const position = raw < 0 ? positions.length + raw : raw - 1;
        let local = group.index.get(position);
        if (local === undefined) {
          local = group.index.size;
          group.index.set(position, local);
          const p = positions[position] ?? [0, 0, 0];
          group.vertices.push(p[0], p[1], p[2]);
        }
        return local;
      });
      for (let i = 1; i + 1 < ids.length; i += 1) {
        group.triangles.push(ids[0]!, ids[i]!, ids[i + 1]!);
      }
    }
  }
  return [...groups.entries()].map(([name, group]): MeshGroup => ({
    name,
    color: colors.get(name) ?? [0.7, 0.7, 0.7],
    vertices: group.vertices,
    triangles: group.triangles,
  }));
};
