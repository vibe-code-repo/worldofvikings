/**
 * The GLSL of the gradient sky (ADR-0024).
 *
 * A gradient rather than a panorama, for three reasons that all outlive the
 * look: it needs no asset, so a clean clone and a machine with the private
 * store see the same sky (ADR-0015); its horizon is a colour the fog is tied to
 * rather than a pixel someone would have to sample; and the sun's glow follows
 * the sun's actual direction, so moving the light in a world file moves the
 * bright part of the sky with it instead of leaving it behind.
 *
 * Kept in its own Babylon-free module for the same reason `terrain-shader.ts`
 * is: shader strings that a unit test can read are shader strings whose
 * uniforms cannot silently drift from what the material binds.
 */

/**
 * The sky as a function of direction, as GLSL both programs paste in.
 *
 * A function rather than a copied dozen lines, because the ground reflects this
 * sky (ADR-0032) and a reflection of a *different* gradient is worse than no
 * reflection at all: the horizon would sit at one height in the dome and at
 * another in the puddle below it, and nothing in either file would say why.
 *
 * The gradient is biased with `pow(up, 0.45)` so that most of the transition
 * happens in the lower third of the sky — which is where an evening sky
 * actually changes colour, and where a linear ramp looks like a poster. Below
 * the horizon the dome darkens quickly: nothing should ever be looking there,
 * but a terrain tile is 300 m square and its edge is 150 m from the middle, so
 * something always is.
 *
 * `sunSpread` maps to the exponent of the glow: 0 gives a hard little disc, 1
 * washes the whole hemisphere.
 */
export const SKY_GRADIENT_FUNCTION = `vec3 wovSkyColor(
  vec3 direction,
  vec3 zenithColor,
  vec3 horizonColor,
  vec3 sunColor,
  vec3 sunDirection,
  float sunSpread
) {
  // Above the horizon the sky climbs to the zenith colour.
  float up = clamp(direction.y, 0.0, 1.0);
  vec3 sky = mix(horizonColor, zenithColor, pow(up, 0.45));

  // Below it, it drops away fast and dark. That half of the dome is what shows
  // past the edge of a terrain tile, and a warm horizon colour continued
  // downwards reads as a beach stretching to the frame edge.
  float down = clamp(-direction.y * 8.0, 0.0, 1.0);
  sky = mix(sky, horizonColor * 0.16, down);

  // The sun sits opposite the direction its light travels.
  float toSun = max(dot(direction, -sunDirection), 0.0);
  float sharpness = mix(220.0, 3.0, clamp(sunSpread, 0.0, 1.0));
  sky += sunColor * pow(toSun, sharpness);

  return sky;
}
`;

/** Attributes the sky program reads. Position only — the box is its own dome. */
export const SKY_ATTRIBUTES = ['position'] as const;

/** Uniforms the sky material binds, by name. */
export const SKY_UNIFORMS = [
  'worldViewProjection',
  'uZenithColor',
  'uHorizonColor',
  'uSunColor',
  'uSunDirection',
  'uSunSpread',
] as const;

/**
 * The vertex program.
 *
 * `vDirection` is the *object-space* position of the box corner, which is the
 * view direction because the mesh is a cube centred on the camera
 * (`infiniteDistance`). Reading the direction off the geometry rather than
 * reconstructing it from the inverse view-projection keeps the program to four
 * lines and works the same on both backends.
 */
export const SKY_VERTEX_SOURCE = `precision highp float;

attribute vec3 position;

uniform mat4 worldViewProjection;

varying vec3 vDirection;

void main(void) {
  vDirection = position;
  gl_Position = worldViewProjection * vec4(position, 1.0);
}
`;

/**
 * The fragment program: a vertical gradient with a glow around the sun.
 *
 * The gradient is biased with `pow(up, 0.45)` so that most of the transition
 * happens in the lower third of the sky — which is where an evening sky
 * actually changes colour, and where a linear ramp looks like a poster.
 *
 * `uSunSpread` maps to the exponent of the glow: 0 gives a hard little disc,
 * 1 washes the whole hemisphere. It is one uniform rather than a second colour
 * stop because "how far does the warmth reach" is the only thing an author ever
 * wants to change about it.
 *
 * Below the horizon the dome darkens quickly. Nothing should ever be looking
 * there — but a terrain tile is 300 m square and its edge is 150 m from the
 * middle, so something always is.
 */
export const SKY_FRAGMENT_SOURCE = `precision highp float;

varying vec3 vDirection;

uniform vec3 uZenithColor;
uniform vec3 uHorizonColor;
uniform vec3 uSunColor;
/** The direction the sunlight travels, normalised. */
uniform vec3 uSunDirection;
uniform float uSunSpread;

${SKY_GRADIENT_FUNCTION}
void main(void) {
  vec3 sky = wovSkyColor(
    normalize(vDirection),
    uZenithColor,
    uHorizonColor,
    uSunColor,
    uSunDirection,
    uSunSpread
  );
  gl_FragColor = vec4(sky, 1.0);
}
`;
