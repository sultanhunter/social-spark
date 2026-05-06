export const ASSET_STYLE_PRESETS = [
  {
    id: "original",
    label: "Original Prompt",
    description: "Use each generated asset prompt as-is.",
    stylePrompt: "",
    referenceImagePath: "",
  },
  {
    id: "muslimah_3d_mascot",
    label: "3D Muslimah Mascot",
    description: "3D pastel mascot style with clean white-background outputs.",
    stylePrompt:
      "3D stylized illustration of a loving Muslim mother wearing a soft pastel pink hijab, gently hugging her young child. Cute app mascot aesthetic, soft studio lighting, highly detailed but clean surfaces. Isolated on a pure white background.",
    referenceImagePath: "/assets/style-references/3d-style.png",
  },
  {
    id: "pixar_3d_characters",
    label: "Pixar 3D Characters",
    description: "Expressive cinematic 3D character look inspired by Pixar-style animation.",
    stylePrompt:
      "Pixar-style 3D animated character illustration with expressive faces, appealing proportions, detailed cloth and skin shading, soft global illumination, warm cinematic color grading, and polished high-quality render finish.",
    referenceImagePath: "/assets/style-references/pixar-3d-style.jpg",
  },
  {
    id: "miswak_2d_premium",
    label: "Miswak 2D Premium",
    description: "Bold flat-2D illustration style with clean geometry, polished vector shading, and graphic clarity.",
    stylePrompt:
      "Flat 2D vector-style illustration with premium polish: clean geometric construction, smooth gradient shading, crisp edges, subtle outline accents, minimal texture, and strong visual clarity. Keep lighting simple and graphic (not photoreal), with gentle shading and intentional shape hierarchy. This style must work for any asset type (objects, characters, scenes, backgrounds, or environments), so do not force icon composition. Preserve the scene's intended color palette; apply this style to form, rendering, and finish rather than forcing any specific colors.",
    referenceImagePath: "/assets/style-references/miswak-2d-style.png",
  },
] as const;

export type AssetStylePreset = (typeof ASSET_STYLE_PRESETS)[number];
export type AssetStylePresetId = AssetStylePreset["id"];

export const DEFAULT_ASSET_STYLE_PRESET: AssetStylePresetId = "original";

export function isAssetStylePresetId(value: unknown): value is AssetStylePresetId {
  if (typeof value !== "string") return false;
  return ASSET_STYLE_PRESETS.some((preset) => preset.id === value);
}

export function getAssetStylePreset(
  styleId: AssetStylePresetId | null | undefined
): AssetStylePreset {
  const normalizedId = styleId || DEFAULT_ASSET_STYLE_PRESET;
  return (
    ASSET_STYLE_PRESETS.find((preset) => preset.id === normalizedId) ||
    ASSET_STYLE_PRESETS[0]
  );
}
