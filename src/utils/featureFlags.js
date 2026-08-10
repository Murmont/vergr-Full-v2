// Build-time feature switches.
//
// These HIDE features, they do not delete them. Every code path behind a false
// flag still exists and still compiles, so turning one back on is a one-line
// change rather than a rebuild of the feature.

/**
 * AR face masks (Status camera + live streaming).
 *
 * OFF since 2026-07-28. The mask models are Jeeliz's face-tracking DEMO
 * assets: roughly 2,000 triangles each, several with no texture at all. The
 * renderer was rewritten to draw them properly with WebGL and PBR, and the
 * conclusion after seeing them rendered correctly was that the ART is the
 * limit, not the renderer. Shipping them would set the app's quality bar at
 * something well below what people expect from a camera filter.
 *
 * Turning this back on needs, in order:
 *   1. Production filter models — glTF 2.0, PBR metallic-roughness, 20k-80k
 *      tris, licensed for commercial redistribution
 *   2. An HDRI environment map for image-based lighting
 *   3. MediaPipe's facialTransformationMatrixes (real 6DoF head pose) and
 *      faceBlendshapes instead of the current two-eye anchor and yaw guess
 *   4. An occluder built from the canonical face mesh, not a generic head
 *
 * Background effects (blur / violet / studio) and colour Looks are UNAFFECTED
 * and stay available. They do not depend on any of the above.
 */
export const MASKS_ENABLED = false;
