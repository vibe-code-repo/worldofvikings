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

void main(void) {
  vec3 direction = normalize(vDirection);

  // Above the horizon the sky climbs to the zenith colour.
  float up = clamp(direction.y, 0.0, 1.0);
  vec3 sky = mix(uHorizonColor, uZenithColor, pow(up, 0.45));

  // Below it, it drops away fast and dark. That half of the dome is what shows
  // past the edge of a terrain tile, and a warm horizon colour continued
  // downwards reads as a beach stretching to the frame edge — measured on the
  // village tile, whose ground stops 150 m from the middle.
  float down = clamp(-direction.y * 8.0, 0.0, 1.0);
  sky = mix(sky, uHorizonColor * 0.16, down);

  // The sun sits opposite the direction its light travels.
  float toSun = max(dot(direction, -uSunDirection), 0.0);
  float sharpness = mix(220.0, 3.0, clamp(uSunSpread, 0.0, 1.0));
  float glow = pow(toSun, sharpness);
  sky += uSunColor * glow;

  gl_FragColor = vec4(sky, 1.0);
}
`;
