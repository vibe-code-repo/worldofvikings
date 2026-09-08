/**
 * What `pnpm import:audio` takes, what it calls each clip, and how it re-encodes
 * it — the whole decision, with no file system and no child process in it.
 *
 * **Every clip is addressed by the SHA-256 of its source bytes, never by its
 * source file name.** That is not a stylistic choice. A source file name is the
 * one thing about this export that may not enter the repository, and a table of
 * "old name → new name" would carry all 44 of them. Hashing also gives three
 * things for free that a name-keyed table would not:
 *
 * - **Renaming the export changes nothing.** The importer finds the same clip.
 * - **Duplicates collapse by themselves.** Several groups in the export contain
 *   byte-identical pairs under different names; two entries can never point at
 *   two copies of one recording without that being visible as one hash.
 * - **A silent substitution is impossible.** If a file's bytes change, it is no
 *   longer the clip that was reviewed, and the importer says so instead of
 *   re-encoding whatever now sits under that name.
 *
 * The cost is that the table is not readable as a mapping — you cannot tell from
 * this file which source file `gravel-01` came from. That is the point.
 */

/** How a clip is re-encoded. The sources are grossly over-encoded for what they are. */
export type AudioEncodeProfile =
  /** A short sound heard once. Mono: it is either 2D or a point in space. */
  | 'one-shot'
  /** A short sound heard continuously from one place. Mono, for the same reason. */
  | 'loop'
  /** A zone-wide bed. Stereo, because width is most of what a bed contributes. */
  | 'bed';

/** One clip this import takes. */
export interface AudioClipSpec {
  /** Where it is written, relative to the store root; also its manifest path. */
  readonly path: string;
  /** SHA-256 of the source file's bytes, algorithm-prefixed. */
  readonly sourceHash: string;
  readonly profile: AudioEncodeProfile;
  /**
   * Seconds to keep from the start, when the source is longer than the clip
   * needs to be. Memory, not download, is what a long bed costs: a stereo
   * minute decodes to roughly 23 MB of float PCM in the sound buffer.
   */
  readonly seconds?: number;
}

/** Sample rate everything is resampled to. Opus works internally at 48 kHz anyway. */
export const AUDIO_SAMPLE_RATE = 48_000;

/** Bit rate and channel count per profile. */
export const AUDIO_ENCODE_SETTINGS: Record<
  AudioEncodeProfile,
  { readonly channels: number; readonly bitrateKbps: number }
> = {
  'one-shot': { channels: 1, bitrateKbps: 48 },
  loop: { channels: 1, bitrateKbps: 48 },
  bed: { channels: 2, bitrateKbps: 64 },
};

/**
 * The ceiling one import run may write, in bytes.
 *
 * A budget rather than a hope: the set this import draws from is 85 MB, most of
 * it music and creature vocalisations that nothing can play yet. The number is
 * roughly twice what the current list encodes to, so it catches a profile
 * changed to something wasteful without failing on one clip being added.
 */
export const AUDIO_IMPORT_BUDGET_BYTES = 2 * 1024 * 1024;

/**
 * The clips this phase takes: village footsteps, two ambience beds, three
 * placed emitters and the animal one-shots that make an evening village sound
 * inhabited without needing a single creature to exist.
 *
 * Deliberately not taken: creature vocalisations, melee and weapon sets, music,
 * UI sounds, jump and land, firearms, and the snow, metal and tile footstep
 * banks — nothing in this repository can select or fire any of them. See the
 * package README.
 */
export const AUDIO_CLIPS: readonly AudioClipSpec[] = [
  // --- Footsteps. Village ground is gravel, rock and grass; gravel serves both
  // rocks and grass serves moss. Wood and water are carried for the plank paths
  // and the dock, which nothing can select yet — the banks exist so that the
  // phase which can is data only.
  {
    path: 'audio/footsteps/gravel-01.ogg',
    sourceHash: 'sha256-bf73b53a2475d79be3253a4b8a40a1d9943389cbcbc68ab042754c281640114a',
    profile: 'one-shot',
  },
  {
    path: 'audio/footsteps/gravel-02.ogg',
    sourceHash: 'sha256-488e096c2869fb21098305a8725728cddd2abad5a98ce3f0810d20c095896bd1',
    profile: 'one-shot',
  },
  {
    path: 'audio/footsteps/gravel-03.ogg',
    sourceHash: 'sha256-c56e438e86f5fa6ad6cd017560636d4ff3b400ce9894030389b5152249a1b74b',
    profile: 'one-shot',
  },
  {
    path: 'audio/footsteps/gravel-04.ogg',
    sourceHash: 'sha256-8564f5f2645b19b4caca796184baa0c7063f849a98865605eea907afbc829c30',
    profile: 'one-shot',
  },
  {
    path: 'audio/footsteps/gravel-05.ogg',
    sourceHash: 'sha256-73a7ec465cc723a1c6a9499a6a29239b91aa99242f9acebded8af2c22ca05776',
    profile: 'one-shot',
  },
  {
    path: 'audio/footsteps/gravel-06.ogg',
    sourceHash: 'sha256-da71c5a54866d5dbc758c55faf57213e2393d8995ff03da84d9c071083b80e5c',
    profile: 'one-shot',
  },
  {
    path: 'audio/footsteps/gravel-07.ogg',
    sourceHash: 'sha256-117d8dc66dd4697abbf5606d2eb1651e21bf4da6c3cbe5aef308e5621a049eca',
    profile: 'one-shot',
  },
  {
    path: 'audio/footsteps/gravel-08.ogg',
    sourceHash: 'sha256-fc1916a82ee4a078a52aaad56d3830340e05dd6b1e311928e5b8a3ddfa042633',
    profile: 'one-shot',
  },
  {
    path: 'audio/footsteps/gravel-09.ogg',
    sourceHash: 'sha256-e6fcf70bcdd7bfd82b11f8a82753bf8ae3df759fe4883dc3c6293e581cf46f6a',
    profile: 'one-shot',
  },
  {
    path: 'audio/footsteps/gravel-10.ogg',
    sourceHash: 'sha256-4c98e4c8548832aabb7bd90fe41cc030ee3e9e07671770ee8c8439b8b3b84dbd',
    profile: 'one-shot',
  },
  {
    path: 'audio/footsteps/grass-01.ogg',
    sourceHash: 'sha256-bd5a7790200754b735db5ac96095a963fb9865cdfe613c09726132c678fd6bdf',
    profile: 'one-shot',
  },
  {
    path: 'audio/footsteps/grass-02.ogg',
    sourceHash: 'sha256-fcd28960cde46ddbe1ac1d1f477566798a2edda73469fae24bd2ffa8b3443f4f',
    profile: 'one-shot',
  },
  {
    path: 'audio/footsteps/grass-03.ogg',
    sourceHash: 'sha256-3566f3f1441f7cd4c9a7beecdb3caa6dd8400e6ef9d90162013dfdab2b16c225',
    profile: 'one-shot',
  },
  {
    path: 'audio/footsteps/grass-04.ogg',
    sourceHash: 'sha256-c3572bb22c2f3bbf6ee6c27d149c248f874ad8c9dae1640020f9498773db5cc0',
    profile: 'one-shot',
  },
  {
    path: 'audio/footsteps/grass-05.ogg',
    sourceHash: 'sha256-0bb0a8bdcc5c06182ed240154b53685095fd7fd3a769dc6178ffe4ae104273c9',
    profile: 'one-shot',
  },
  {
    path: 'audio/footsteps/grass-06.ogg',
    sourceHash: 'sha256-f1439723750b04000e8f8e4eabe3f99360bcb4e9db96fd409704f7ff59ad6b97',
    profile: 'one-shot',
  },
  {
    path: 'audio/footsteps/grass-07.ogg',
    sourceHash: 'sha256-8ebb49378e0f53f27dfcb75b1ed482ea10ca18f2eba3303a1c4ea698e4e9cb44',
    profile: 'one-shot',
  },
  {
    path: 'audio/footsteps/grass-08.ogg',
    sourceHash: 'sha256-dcca766bf385862ec142124ba738bbbf9612c7bfe1020c8cfea7c07bf6ffc9ad',
    profile: 'one-shot',
  },
  {
    path: 'audio/footsteps/grass-09.ogg',
    sourceHash: 'sha256-a58463e512f5aae151328896ef3ac83d541736054c462d2909e59338a984b87a',
    profile: 'one-shot',
  },
  {
    path: 'audio/footsteps/wood-01.ogg',
    sourceHash: 'sha256-7407d0c7005a6d3f7597bdbc4afbfd1e8bbd2f3ab5e1003aac24852fb6a21f69',
    profile: 'one-shot',
  },
  {
    path: 'audio/footsteps/wood-02.ogg',
    sourceHash: 'sha256-e546fbdcb4700af8cfcad4a28e54ed3767ab1a6b50e9f29a04e40123984a614f',
    profile: 'one-shot',
  },
  {
    path: 'audio/footsteps/wood-03.ogg',
    sourceHash: 'sha256-370a842617737f15a8afd9762d515f5f0fa3dbcca64e74cf80ccb4f5db67c4ad',
    profile: 'one-shot',
  },
  {
    path: 'audio/footsteps/wood-04.ogg',
    sourceHash: 'sha256-113a221d1667bd80b1bf9aabd392f0023997d87b872d6517510abc710609a99b',
    profile: 'one-shot',
  },
  {
    path: 'audio/footsteps/water-01.ogg',
    sourceHash: 'sha256-88d206d334d9585fb5a1a8cba007e1ae635e070737cd0862c523fb4e0d486640',
    profile: 'one-shot',
  },
  {
    path: 'audio/footsteps/water-02.ogg',
    sourceHash: 'sha256-2989abeff36b39f4f9c06bdb37d2be7fd6a15dbf3fb4797503e6cbb712e0d818',
    profile: 'one-shot',
  },
  {
    path: 'audio/footsteps/water-03.ogg',
    sourceHash: 'sha256-4ed461097b4dfd557f00ec2195c486be0db8242efeca0f6aa1a84ad90c8a64a7',
    profile: 'one-shot',
  },
  {
    path: 'audio/footsteps/water-04.ogg',
    sourceHash: 'sha256-929b5695970a42dec765eb3c8b1718baa65608eec0baabe2bde479715d070e0c',
    profile: 'one-shot',
  },
  {
    path: 'audio/footsteps/water-05.ogg',
    sourceHash: 'sha256-4ea28bb3a0a5f2823864dbe9b63c23e6c212d8db2883c899318fc3b4e8e3aa02',
    profile: 'one-shot',
  },

  // --- Animal one-shots. They need no creatures: they are randomly timed
  // emitters on world data, and they are what keeps an evening village from
  // sounding like a wind machine.
  {
    path: 'audio/animals/crow-01.ogg',
    sourceHash: 'sha256-35733ce86ed12d20a853026192b76cf5c6d9610afc86cd910cf35efd31030ca9',
    profile: 'one-shot',
  },
  {
    path: 'audio/animals/crow-02.ogg',
    sourceHash: 'sha256-442fd982623e604cf77f3a45a303d26f05859aa9a896f53d7b0d59c26c1610dc',
    profile: 'one-shot',
  },
  {
    path: 'audio/animals/crow-03.ogg',
    sourceHash: 'sha256-6b49e4d4a94b6c75a424bcb7df3504c9a5c21a2c1d1d1e2cede8a2dffcf0f1f1',
    profile: 'one-shot',
  },
  {
    path: 'audio/animals/crow-04.ogg',
    sourceHash: 'sha256-e14feff88724b1d701f4d639013b19848be92d4eb947dadaab4697748e04d55b',
    profile: 'one-shot',
  },
  {
    path: 'audio/animals/crow-05.ogg',
    sourceHash: 'sha256-0cb07671e94c171fe7f881b69904a54254cd8ac1ae5d0cd04d6240de4194b5d5',
    profile: 'one-shot',
  },
  {
    path: 'audio/animals/rooster-01.ogg',
    sourceHash: 'sha256-97916cc43d5f3f2752c66cd2c3b01669835e8d6c9a3776bddb9ba21d97f38fd3',
    profile: 'one-shot',
  },
  {
    path: 'audio/animals/rooster-02.ogg',
    sourceHash: 'sha256-b3d2dd31b74d36ebb64bbaa2d0f5cf4fe81ce41854aed5859571c50e759eaae1',
    profile: 'one-shot',
  },
  {
    path: 'audio/animals/chicken-01.ogg',
    sourceHash: 'sha256-38d024069945d9f1dc285c2e7acfbaf58293457a5defe8c8ee7829f3aeba8432',
    profile: 'one-shot',
  },
  {
    path: 'audio/animals/chicken-02.ogg',
    sourceHash: 'sha256-32723b1d853ec4a4cee5e8c99f92c06c3fa98de0ad02c627c30a8b487ca91843',
    profile: 'one-shot',
  },
  {
    path: 'audio/animals/cow-01.ogg',
    sourceHash: 'sha256-6dbaeab0eaaca830e305e6c69244db56aa6c3951efa0d62a8b618ebfa75d858e',
    profile: 'one-shot',
  },
  {
    path: 'audio/animals/cat-01.ogg',
    sourceHash: 'sha256-cd3977b0d834eda22db8720926753d50651290056b1848030bd171e2411a5a32',
    profile: 'one-shot',
  },

  // --- Ambience beds. Both are evening-neutral wind; the day beds in the export
  // are not taken, because the village is an evening scene.
  {
    path: 'audio/ambience/forest-wind-gusts.ogg',
    sourceHash: 'sha256-76572d5fadfbdc93605ba1d079bd263f092f7cba62acb4c665392ee29919e87b',
    profile: 'bed',
  },
  {
    // 74 s in the source. Forty is already longer than anyone stands still, and
    // it is 15 MB less decoded PCM held for the whole session.
    path: 'audio/ambience/forest-wind-crows.ogg',
    sourceHash: 'sha256-120a81c1e3da72d07d1aba55f02f42edb7a5be64dfb542905c86d4a09c21e8d0',
    profile: 'bed',
    seconds: 40,
  },

  // --- Placed emitters.
  {
    path: 'audio/emitters/fire-small-loop.ogg',
    sourceHash: 'sha256-1df4975717aa58e44a775b2dd06481655e2c68689008d1c1c66dfcfe3a1cd8d6',
    profile: 'loop',
  },
  {
    // 15 s in the source, of which the last two thirds are a decay nobody hears
    // over a village.
    path: 'audio/emitters/forge-hammer.ogg',
    sourceHash: 'sha256-b7c9ac8474ca1bf020ebe2e35c4d25652a55865b5e18a132d059167c89c1bb5c',
    profile: 'loop',
    seconds: 6,
  },
  {
    path: 'audio/emitters/wind-open-ground.ogg',
    sourceHash: 'sha256-8363583868f1e2075b04bbba9bfef7e60b0083638054ca7d7ee17d89c0cd0ad3',
    profile: 'loop',
  },
];

/**
 * The arguments `ffmpeg` is run with for one clip.
 *
 * Three of them are not about sound quality and are the reason this is a
 * function rather than a template string:
 *
 * - `-map_metadata -1` strips every tag the source carries. A title or artist
 *   field is exactly the kind of trace that must not travel into the store.
 * - `-vn` drops an embedded cover image, which would otherwise be muxed into
 *   the Ogg stream as a video track.
 * - `-t` limits the *output* duration and therefore sits after `-i`; put before
 *   it, it would seek the input instead and produce a different clip.
 */
export function ffmpegArgumentsFor(
  clip: AudioClipSpec,
  sourceFile: string,
  targetFile: string,
): readonly string[] {
  const settings = AUDIO_ENCODE_SETTINGS[clip.profile];
  return [
    '-hide_banner',
    '-loglevel',
    'error',
    '-nostdin',
    '-y',
    '-i',
    sourceFile,
    '-map_metadata',
    '-1',
    '-vn',
    ...(clip.seconds === undefined ? [] : ['-t', String(clip.seconds)]),
    '-ac',
    String(settings.channels),
    '-ar',
    String(AUDIO_SAMPLE_RATE),
    '-c:a',
    'libopus',
    '-b:a',
    `${String(settings.bitrateKbps)}k`,
    '-vbr',
    'on',
    '-application',
    'audio',
    targetFile,
  ];
}

/** What is known about an encoded clip, measured after it was written. */
export interface AudioClipFacts {
  readonly profile: AudioEncodeProfile;
  /** Duration of the encoded file, in seconds. */
  readonly seconds: number;
}

/**
 * The `origin` a clip's manifest row carries.
 *
 * Acoustic facts only — duration, channels, sample rate, encoder settings.
 * Nothing about where the recording came from can be said honestly, and a
 * plausible guess in a provenance field is worse than an admitted gap
 * (spec §46).
 */
export function audioClipOrigin(facts: AudioClipFacts): string {
  const settings = AUDIO_ENCODE_SETTINGS[facts.profile];
  const channels = settings.channels === 1 ? 'mono' : 'stereo';
  return (
    `${facts.seconds.toFixed(2)} s, ${channels}, ` +
    `${String(AUDIO_SAMPLE_RATE / 1000)} kHz, ` +
    `re-encoded to Opus at ${String(settings.bitrateKbps)} kbps (VBR) by pnpm import:audio.`
  );
}

/** The group a clip belongs to — the folder under `audio/`, for the report. */
export function audioClipGroup(clipPath: string): string {
  return clipPath.split('/')[1] ?? 'audio';
}
