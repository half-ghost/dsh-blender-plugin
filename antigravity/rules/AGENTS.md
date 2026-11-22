# Blender Bridge (Antigravity MCP)

This plugin exposes the 6 Blender 3.1 tools via MCP (`blender_session`, `blender_op`, `blender_py`, `blender_see`, `blender_run`, `blender_inspect`) together with the bundled `blender-modeling` skill.

## Workflow Rules

1. **Verify connectivity first**: Call `blender_session(action="status")` or `blender_session(action="doctor")` before modifying a live GUI scene. If Blender is open with the bundled `DSH Blender Bridge` addon connected, attach once via `blender_session(action="attach")` and reuse that session.
2. **Use the bundled skill for modeling tasks**: Load the `blender-modeling` skill before non-trivial 3D modeling, reference-image reconstruction, assembly audit/repair, parametric surfaces, or delivery exports.
3. **Op-first, then bpy**: Check `blender_op(op="catalog")` before writing raw `bpy`/`bmesh` scripts for geometry, audit, assembly, or export tasks.
4. **Visual and numeric verification**: Inspect changes incrementally with `blender_py(see=true)` / `blender_see` and read three-state `verdict` (`pass` | `fail` | `degraded`) from QA ops (`audit_mesh`, `asm_scan`, `gate_run`) rather than only `ok`.
5. **Heavy or headless work**: Use `blender_run(action="submit", kind="headless" | "render")` for long scripts or final renders, then track with `status` / `wait` / `collect`.
6. **Safety**: Take a snapshot via `blender_session(action="txn", op="snapshot", label="...")` before destructive topology edits (booleans, remesh, merge).
