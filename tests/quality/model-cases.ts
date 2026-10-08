import type { Kind, Side } from "../../src/game/types";
import type { QualityCase } from "./case-ledger";

export const modelKinds = [
  "bastion",
  "carver",
  "leaper",
  "link",
  "core",
] as const;
export type ModelKind = Kind | "core";
export const modelSides: readonly Side[] = ["white", "black"];
export const modelViews = ["board", "top", "oblique"] as const;
export type ModelView = (typeof modelViews)[number];
export const geometryChecks = [
  "finite-positions",
  "finite-normals",
  "unit-normals",
  "bounded-uvs",
  "nondegenerate-triangles",
  "valid-indices",
  "floor-contact",
  "tile-clearance",
  "height-envelope",
  "substantial-volume",
  "unique-part-names",
  "positive-scales",
  "cast-shadows",
  "receive-shadows",
  "draw-call-budget",
  "triangle-budget",
  "material-budget",
  "solid-plinth-support",
] as const;
export const surfaceChecks = [
  "standard-pbr",
  "opaque-surfaces",
  "roughness-range",
  "metalness-range",
  "accent-grayscale-contrast",
  "buffer-budget",
] as const;
export const teamChecks = [
  "matching-geometry",
  "matching-part-transforms",
  "grayscale-team-contrast",
  "independent-ownership",
] as const;
export const disposalChecks = [
  "all-geometries-once",
  "all-materials-once",
  "nested-group-ownership",
  "shared-reference-deduplication",
  "preserve-transforms",
] as const;
export type ModelScenario = QualityCase & {
  kind: ModelKind;
  side?: Side;
  check: string;
  view?: ModelView;
  other?: ModelKind;
};
const assertions: Record<string, string> = {
  "finite-positions":
    "Every position component is finite; real geometry contains vertices.",
  "finite-normals":
    "Every normal component is finite and each vertex has a normal.",
  "unit-normals": "Lighting normals have length 1 within 0.002.",
  "bounded-uvs":
    "Every UV is finite and within the documented procedural geometry range [-1, 2].",
  "nondegenerate-triangles":
    "Every indexed or unindexed triangle has positive surface area above 1e-9 world units squared.",
  "valid-indices":
    "All triangle indices are integers within the position buffer and triangle counts are divisible by three.",
  "floor-contact":
    "Model-local minimum y is zero within 1e-6; placement owns board elevation.",
  "tile-clearance":
    "World x/z extents stay within +/-0.46, leaving a minimum 0.04 world-unit tile gutter.",
  "height-envelope":
    "Every model stays below 1.16 world units to limit neighboring-row occlusion.",
  "substantial-volume":
    "The model occupies at least 0.6 world units in x/z and 0.55 in height.",
  "unique-part-names":
    "Every mesh has a nonempty unique semantic part name for diagnostics and ownership.",
  "positive-scales":
    "Every scale component is positive and all model transforms are finite.",
  "cast-shadows":
    "All opaque model meshes cast shadows in the high-quality renderer.",
  "receive-shadows":
    "All opaque model meshes receive shadows in the high-quality renderer.",
  "draw-call-budget": "Each model has at most 18 visible meshes.",
  "triangle-budget":
    "Each model has at most 5000 triangles; 49 occupied squares remain below 245000 model triangles.",
  "material-budget":
    "Each model owns 2 or 3 reused material instances rather than one allocation per mesh.",
  "solid-plinth-support":
    "The primary solid body meets the solid foot; shared x/z ray-tested opposing surfaces overlap, rather than merely overlapping bounding boxes or a disconnected decorative torus.",
  "standard-pbr":
    "Materials use the supported standard PBR pipeline without external texture requests.",
  "opaque-surfaces":
    "Pieces remain depth-writing, opaque, front-sided surfaces to avoid transparent sorting failures.",
  "roughness-range":
    "Roughness stays in [0.3, 0.75] to avoid mirror-like clipped highlights.",
  "metalness-range":
    "Metalness stays in [0, 0.65] so no model depends on a missing environment map.",
  "accent-grayscale-contrast":
    "Accent/body linear-luminance contrast is at least 3:1 as a palette proxy, not a GPU/WCAG rendering claim.",
  "buffer-budget": "Unique model buffers use no more than 200000 bytes.",
  "matching-geometry":
    "Both teams have identical vertex/index data for the same role.",
  "matching-part-transforms":
    "Both teams share the same local semantic parts and transforms; the board owns opposite-facing rotation.",
  "grayscale-team-contrast":
    "White and black body palette luminance contrast is at least 7:1 before lighting.",
  "independent-ownership":
    "Separate model instances share no mutable geometries or materials.",
  "all-geometries-once": "Disposal signals each owned geometry exactly once.",
  "all-materials-once":
    "Disposal signals each owned material exactly once despite intra-model sharing.",
  "nested-group-ownership":
    "Disposing a parent releases its nested model but not an unrelated sibling resource.",
  "shared-reference-deduplication":
    "Multiple mesh references and material arrays release each owned object only once.",
  "preserve-transforms":
    "Resource disposal neither moves nor removes model parts; scene ownership remains with the renderer.",
};
export const modelScenarios: ModelScenario[] = [];
for (const kind of modelKinds) {
  for (const side of modelSides) {
    for (const check of geometryChecks)
      modelScenarios.push({
        id: `MODEL-GEO-${kind}-${side}-${check}`,
        category: "model.geometry",
        kind,
        side,
        check,
        inputs: { kind, side, check, tileWorldSize: 1 },
        assertions: [assertions[check]],
      });
    for (const check of surfaceChecks)
      modelScenarios.push({
        id: `MODEL-SURFACE-${kind}-${side}-${check}`,
        category: "model.surface-resource",
        kind,
        side,
        check,
        inputs: { kind, side, check },
        assertions: [assertions[check]],
      });
    for (const view of modelViews)
      modelScenarios.push({
        id: `MODEL-VIEW-${kind}-${side}-${view}`,
        category: "model.software-projection",
        kind,
        side,
        check: "coverage",
        view,
        inputs: {
          kind,
          side,
          view,
          sampleGrid: 96,
          projectionWorldSpan: 1.6,
          excludesCommonPlinth: true,
        },
        assertions: [
          "Projected role geometry is unclipped, spans at least 0.14 world units on each screen axis, and covers at least 80 samples. This is software projection, not GPU fidelity or human-recognition evidence.",
          ...(kind === "carver" && view === "board"
            ? [
                "The blade alone spans at least 0.3 screen-projected world units for both team facings; its stem, guard and plinth cannot satisfy this check.",
              ]
            : []),
          ...(kind === "link" && view === "board"
            ? [
                "Both ring-plane normals retain at least 0.42 absolute dot product with the production view direction for each team facing, preventing edge-on apertures.",
              ]
            : []),
        ],
      });
    for (const check of disposalChecks)
      modelScenarios.push({
        id: `MODEL-DISPOSE-${kind}-${side}-${check}`,
        category: "model.resource-disposal",
        kind,
        side,
        check,
        inputs: { kind, side, check },
        assertions: [assertions[check]],
      });
  }
  for (const check of teamChecks)
    modelScenarios.push({
      id: `MODEL-TEAM-${kind}-${check}`,
      category: "model.team-parity",
      kind,
      check,
      inputs: { kind, sides: modelSides, check },
      assertions: [assertions[check]],
    });
}
for (let a = 0; a < modelKinds.length; a++)
  for (let b = a + 1; b < modelKinds.length; b++) {
    for (const side of modelSides)
      for (const view of modelViews)
        modelScenarios.push({
          id: `MODEL-DISTINCT-${modelKinds[a]}-${modelKinds[b]}-${side}-${view}`,
          category: "model.role-distinction",
          kind: modelKinds[a],
          other: modelKinds[b],
          side,
          view,
          check: "distinct",
          inputs: {
            firstKind: modelKinds[a],
            secondKind: modelKinds[b],
            side,
            view,
            sampleGrid: 96,
            projectionWorldSpan: 1.6,
            excludesCommonPlinth: true,
          },
          assertions: [
            "The symmetric difference of upper-role occupancy masks is at least 12% of their union; names and material colors do not participate. This is a software silhouette proxy, not a real-human recognition test.",
          ],
        });
  }
