'use strict';

/**
 * Authored catalogue and timelines.
 *
 * All three features are open-licensed Blender Foundation films (CC BY 3.0).
 * The trivia entries are production facts; scene/character/glossary metadata is
 * authored for this project. Timestamps are approximate scene markers — that is
 * explicitly allowed by the PRD (§2, §14.1) and is what the trivia engine
 * triggers on.
 */

/**
 * Media strategy.
 *
 * The three short titles stream from the API's own origin (the clips are
 * committed under server/public/media) so playback never depends on a third
 * party. The three full films stay on their upstream open-film host, and each
 * one carries a `fallbackAssetUrl` pointing at a local clip: if the viewer's
 * network blocks that host — archive.org is unreachable on several ISPs — the
 * player switches to the local clip instead of showing a dead stage. Timeline,
 * trivia and the co-pilot all keep working either way.
 */
const LOCAL_MEDIA = '/api/v1/media';

const MEDIA = {
  sintel: 'https://archive.org/download/Sintel/sintel-2048-surround_512kb.mp4',
  bigBuckBunny:
    'https://archive.org/download/BigBuckBunny_124/Content/big_buck_bunny_720p_surround.mp4',
  elephantsDream: 'https://archive.org/download/ElephantsDream/ed_1024_512kb.mp4',
  jellyfish: `${LOCAL_MEDIA}/jellyfish-10s.mp4`,
  sintelExcerpt: `${LOCAL_MEDIA}/sintel-10s.mp4`,
  bunnyExcerpt: `${LOCAL_MEDIA}/bunny-10s.mp4`,
  sintelSample: `${LOCAL_MEDIA}/sintel-10s.mp4`,
  bunnySample: `${LOCAL_MEDIA}/bunny-10s.mp4`,
  genericSample: `${LOCAL_MEDIA}/jellyfish-10s.mp4`,
};

/**
 * Poster frames, extracted from the films themselves and committed alongside the
 * clips. They are served from the API origin for the same reason as the video:
 * no card should depend on a third-party host being reachable.
 */
const POSTERS = {
  sintel: `${LOCAL_MEDIA}/posters/sintel.jpg`,
  bigBuckBunny: `${LOCAL_MEDIA}/posters/big-buck-bunny.jpg`,
  elephantsDream: `${LOCAL_MEDIA}/posters/elephants-dream.jpg`,
  drift: `${LOCAL_MEDIA}/posters/drift.jpg`,
  ridgeShort: `${LOCAL_MEDIA}/posters/the-ridge-short.jpg`,
  meadowShort: `${LOCAL_MEDIA}/posters/meadow-short.jpg`,
};

const SINTEL_TIMELINE = [
  {
    id: 'st_001',
    ts: 6,
    type: 'beat',
    title: 'Snowbound opening',
    scene: 'Mountain ridge, dawn',
    text: 'A lone traveller crosses a wind-scoured mountain ridge, wrapped against the cold.',
    tags: ['opening', 'snow', 'mountain', 'traveller', 'journey'],
  },
  {
    id: 'st_002',
    ts: 20,
    endTs: 888,
    type: 'character',
    character: 'Sintel',
    text: 'Sintel — a young woman travelling alone with a spear, searching for the dragon she once raised.',
    tags: ['sintel', 'protagonist', 'girl', 'woman', 'traveller', 'hunter', 'spear'],
    priority: 'high',
  },
  {
    id: 'st_003',
    ts: 42,
    type: 'trivia',
    title: 'Third open movie',
    text: "Sintel premiered in 2010 as the Blender Institute's third open movie, after Elephants Dream and Big Buck Bunny.",
    tags: ['production', '2010', 'open movie', 'blender', 'release'],
    priority: 'high',
  },
  {
    id: 'st_004',
    ts: 68,
    type: 'beat',
    title: 'The ambush',
    scene: 'Cliff edge',
    text: 'A winged creature attacks on the ridge; Sintel is driven off the cliff and falls into a ravine.',
    tags: ['attack', 'ambush', 'dragon', 'cliff', 'fall', 'ravine'],
  },
  {
    id: 'st_005',
    ts: 108,
    endTs: 888,
    type: 'character',
    character: 'Scales',
    text: 'Scales — the wounded dragon hatchling Sintel finds in the ravine and nurses back to health.',
    tags: ['scales', 'dragon', 'hatchling', 'baby', 'wounded', 'friend', 'companion'],
    priority: 'high',
  },
  {
    id: 'st_006',
    ts: 128,
    type: 'trivia',
    text: "Sintel's production files and assets were published under Creative Commons Attribution 3.0, so the film can be re-rendered and remixed.",
    tags: ['creative commons', 'licence', 'assets', 'open', 'remix'],
  },
  {
    id: 'st_007',
    ts: 152,
    type: 'glossary',
    term: 'Open movie',
    definition:
      'A film made with open-source tools whose production files are released for anyone to reuse, study or remix.',
    text: 'Glossary entry for the licensing model behind the Blender open movies.',
    tags: ['open movie', 'licence', 'blender', 'production'],
  },
  {
    id: 'st_008',
    ts: 176,
    type: 'beat',
    title: 'First contact',
    scene: 'Ravine floor',
    text: 'In the ravine, Sintel lowers her spear and offers the frightened hatchling water.',
    tags: ['ravine', 'hatchling', 'water', 'trust', 'calm', 'first contact'],
  },
  {
    id: 'st_009',
    ts: 205,
    type: 'variation_point',
    variationKind: 'subtitle',
    title: 'Choose the caption for the moment Sintel calms the hatchling',
    scene: 'Ravine floor',
    text: 'An authored caption variant sits over the moment Sintel reassures the hatchling.',
    tags: ['caption', 'subtitle', 'localization', 'hatchling', 'reassure', 'variant'],
    defaultOptionId: 'opt_en',
    options: [
      {
        id: 'opt_en',
        label: 'Original English',
        description: 'The default authored line.',
        subtitle: { locale: 'en', text: "Keep still — I won't hurt you." },
      },
      {
        id: 'opt_hi',
        label: 'Hindi localization',
        description: 'Approved Hindi caption for the same moment.',
        subtitle: { locale: 'hi', text: 'सावधान मत हो — मैं तुम्हें चोट नहीं पहुँचाऊँगी।' },
      },
      {
        id: 'opt_es',
        label: 'Spanish localization',
        description: 'Approved Spanish caption for the same moment.',
        subtitle: { locale: 'es', text: 'No te muevas — no voy a hacerte daño.' },
      },
    ],
  },
  {
    id: 'st_010',
    ts: 232,
    endTs: 700,
    type: 'character',
    character: 'The scarred dragon',
    text: 'A scarred adult dragon that Sintel believes took Scales; it reappears in the canyon climax.',
    tags: ['scarred', 'dragon', 'adult', 'antagonist', 'canyon', 'scar'],
  },
  {
    id: 'st_011',
    ts: 275,
    type: 'beat',
    title: 'A bond forms',
    scene: 'Camp, night',
    text: 'Sintel shares her food with the hatchling and names it Scales; the two begin travelling together.',
    tags: ['bond', 'food', 'naming', 'travels', 'friendship', 'camp'],
  },
  {
    id: 'st_012',
    ts: 320,
    type: 'trivia',
    text: 'The score was composed by Jan Morgenstern; the film was written and directed by Colin Levy.',
    tags: ['score', 'music', 'composer', 'director', 'colin levy', 'jan morgenstern'],
  },
  {
    id: 'st_013',
    ts: 350,
    type: 'beat',
    title: 'Growing up',
    scene: 'Montage',
    text: 'A montage carries the pair across seasons as the hatchling grows into a young dragon.',
    tags: ['montage', 'seasons', 'grows', 'dragon', 'time'],
  },
  {
    id: 'st_014',
    ts: 415,
    type: 'trivia',
    text: 'Sintel runs nearly fifteen minutes and was produced by a small core team at the Blender Institute in Amsterdam.',
    tags: ['runtime', 'production', 'amsterdam', 'blender institute'],
  },
  {
    id: 'st_015',
    ts: 455,
    endTs: 820,
    type: 'character',
    character: 'Sintel the hunter',
    text: 'Years of searching harden Sintel into a determined hunter, worn down by the road.',
    tags: ['older', 'hunter', 'determined', 'years', 'search', 'sintel'],
  },
  {
    id: 'st_016',
    ts: 500,
    type: 'beat',
    title: 'The search',
    scene: 'Desert',
    text: 'Sintel crosses pale dunes and ruined settlements, following rumours of a great dragon.',
    tags: ['desert', 'dunes', 'search', 'rumours', 'journey'],
  },
  {
    id: 'st_017',
    ts: 545,
    type: 'glossary',
    term: 'Matte painting',
    definition:
      'A painted or digitally created backdrop that extends a filmed or animated environment beyond what was physically built.',
    tags: ['matte painting', 'backdrop', 'environment', 'vfx'],
  },
  {
    id: 'st_018',
    ts: 610,
    type: 'variation_point',
    variationKind: 'narrative',
    title: 'Choose the framing line before the canyon confrontation',
    text: 'The host can put one of these authored framing lines on screen before the duel.',
    tags: ['narration', 'framing', 'canyon', 'confrontation', 'ending'],
    defaultOptionId: 'opt_a',
    options: [
      {
        id: 'opt_a',
        label: 'Years of hunting',
        description: 'Sombre framing.',
        subtitle: { locale: 'en', text: 'She has hunted for years. Now the hunt ends.' },
      },
      {
        id: 'opt_b',
        label: 'The dragon was waiting',
        description: 'Tragic-irony framing.',
        subtitle: { locale: 'en', text: 'The dragon she is hunting has been waiting for her.' },
      },
    ],
  },
  {
    id: 'st_019',
    ts: 655,
    type: 'trivia',
    title: 'The reveal',
    text: "The canyon duel is the film's climax; the scarred dragon's old wound reveals that Sintel has been hunting Scales all along.",
    tags: ['climax', 'canyon', 'scar', 'reveal', 'twist', 'scales'],
    priority: 'high',
  },
  {
    id: 'st_020',
    ts: 700,
    type: 'beat',
    title: 'The wound',
    scene: 'Canyon',
    text: 'The scarred dragon falls, and Sintel sees the healed wound she once dressed in the ravine.',
    tags: ['wound', 'scar', 'recognition', 'grief', 'dragon'],
  },
  {
    id: 'st_021',
    ts: 760,
    type: 'glossary',
    term: 'Creative Commons Attribution',
    definition:
      'A licence that lets others share and adapt a work, including commercially, as long as they credit the creator.',
    tags: ['creative commons', 'attribution', 'licence', 'credit'],
  },
  {
    id: 'st_022',
    ts: 815,
    type: 'variation_point',
    variationKind: 'localization',
    title: 'Choose the closing caption',
    text: 'Unauthorized rewrites are impossible: every option below is pre-authored and pre-approved.',
    tags: ['closing', 'caption', 'localization', 'ending'],
    defaultOptionId: 'opt_en',
    options: [
      {
        id: 'opt_en',
        label: 'English',
        subtitle: { locale: 'en', text: 'Some journeys end where they began.' },
      },
      {
        id: 'opt_hi',
        label: 'Hindi',
        subtitle: { locale: 'hi', text: 'कुछ यात्राएँ वहीं खत्म होती हैं जहाँ से शुरू हुई थीं।' },
      },
      {
        id: 'opt_es',
        label: 'Spanish',
        subtitle: { locale: 'es', text: 'Algunos viajes terminan donde empezaron.' },
      },
    ],
  },
  {
    id: 'st_023',
    ts: 850,
    type: 'trivia',
    text: "The final shot returns to a hatchling in the cave, echoing the film's opening and leaving the ending deliberately ambiguous.",
    tags: ['ending', 'hatchling', 'cave', 'ambiguous', 'final shot'],
  },
];

const BUNNY_TIMELINE = [
  {
    id: 'bb_001',
    ts: 6,
    type: 'beat',
    title: 'Meadow morning',
    scene: 'Meadow',
    text: 'Sunlight spreads across a meadow as birds, butterflies and small animals wake up.',
    tags: ['opening', 'meadow', 'morning', 'sunlight', 'butterfly'],
  },
  {
    id: 'bb_002',
    ts: 18,
    endTs: 596,
    type: 'character',
    character: 'Big Buck Bunny',
    text: 'Big Buck Bunny — a gentle, oversized rabbit who lives in the meadow.',
    tags: ['bunny', 'rabbit', 'protagonist', 'gentle', 'meadow', 'big'],
    priority: 'high',
  },
  {
    id: 'bb_003',
    ts: 34,
    type: 'trivia',
    text: "Big Buck Bunny was released in 2008 as the Blender Institute's second open movie, following Elephants Dream.",
    tags: ['2008', 'open movie', 'blender', 'release', 'second'],
  },
  {
    id: 'bb_004',
    ts: 48,
    endTs: 520,
    type: 'character',
    character: 'The three rodents',
    text: "Frank, Rinky and Gamera — three small rodents who bully the meadow's other animals.",
    tags: ['rodents', 'bullies', 'troublemakers', 'frank', 'rinky', 'gamera'],
  },
  {
    id: 'bb_005',
    ts: 62,
    type: 'beat',
    title: 'The cruelty',
    text: 'The rodents throw fruit at the bunny and squash a butterfly he was watching.',
    tags: ['bullying', 'butterfly', 'fruit', 'cruelty', 'turning point'],
  },
  {
    id: 'bb_006',
    ts: 92,
    type: 'trivia',
    text: 'The film was directed by Sacha Goedegebure and produced by Ton Roosendaal at the Blender Institute.',
    tags: ['director', 'producer', 'sacha goedgebure', 'ton roosendaal', 'production'],
  },
  {
    id: 'bb_007',
    ts: 118,
    type: 'glossary',
    term: 'Rigging',
    definition:
      'The system of bones and controls an animator uses to pose and animate a 3D character.',
    tags: ['rigging', 'animation', 'bones', 'controls', '3d'],
  },
  {
    id: 'bb_008',
    ts: 140,
    type: 'beat',
    title: 'The plan',
    text: 'The bunny snaps. He calmly builds traps from branches, vines and a stolen knife.',
    tags: ['revenge', 'trap', 'branches', 'vines', 'plan', 'construction'],
  },
  {
    id: 'bb_009',
    ts: 210,
    type: 'variation_point',
    variationKind: 'subtitle',
    title: "Choose the caption for the bunny's revenge montage",
    text: 'A pre-authored caption choice for the montage.',
    tags: ['caption', 'subtitle', 'revenge', 'montage', 'variant'],
    defaultOptionId: 'opt_en',
    options: [
      {
        id: 'opt_en',
        label: 'English',
        subtitle: { locale: 'en', text: 'A quiet morning becomes a war of wits.' },
      },
      {
        id: 'opt_hi',
        label: 'Hindi',
        subtitle: { locale: 'hi', text: 'एक शांत सुबह मन की जंग बन जाती है।' },
      },
      {
        id: 'opt_es',
        label: 'Spanish',
        subtitle: { locale: 'es', text: 'Una mañana tranquila se convierte en una guerra de ingenio.' },
      },
    ],
  },
  {
    id: 'bb_010',
    ts: 250,
    type: 'trivia',
    text: "Big Buck Bunny was rendered at 1080p with Blender's own renderer; its fur simulation was demanding for the hardware of the time.",
    tags: ['render', '1080p', 'fur', 'simulation', 'blender', 'technical'],
  },
  {
    id: 'bb_011',
    ts: 300,
    type: 'beat',
    title: 'First trap',
    text: 'The first rodent is launched into the sky by a bent sapling trap.',
    tags: ['trap', 'sapling', 'launch', 'first rodent', 'slapstick'],
  },
  {
    id: 'bb_012',
    ts: 372,
    type: 'beat',
    title: 'Second trap',
    text: 'The second rodent is caught by a swinging log while the bunny watches from a hidden perch.',
    tags: ['trap', 'log', 'second rodent', 'swinging', 'hidden'],
  },
  {
    id: 'bb_013',
    ts: 430,
    type: 'beat',
    title: 'The chase',
    text: 'The largest rodent chases the bunny into the forest and is caught in a net of vines.',
    tags: ['chase', 'forest', 'net', 'vines', 'largest rodent'],
  },
  {
    id: 'bb_014',
    ts: 480,
    type: 'variation_point',
    variationKind: 'narrative',
    title: 'Choose the closing framing for the meadow',
    text: 'Two approved closing cards; the host may put the choice to a vote.',
    tags: ['ending', 'framing', 'narration', 'meadow', 'variant'],
    defaultOptionId: 'opt_a',
    options: [
      {
        id: 'opt_a',
        label: 'Quiet again',
        subtitle: { locale: 'en', text: 'The meadow is quiet again.' },
      },
      {
        id: 'opt_b',
        label: 'Last laugh',
        subtitle: { locale: 'en', text: 'The bunny gets the last laugh.' },
      },
    ],
  },
  {
    id: 'bb_015',
    ts: 520,
    type: 'trivia',
    text: 'Every asset in Big Buck Bunny, including characters, rigs and textures, is available under Creative Commons Attribution 3.0.',
    tags: ['assets', 'creative commons', 'licence', 'rigs', 'textures'],
  },
  {
    id: 'bb_016',
    ts: 555,
    type: 'beat',
    title: 'Sunset',
    text: 'The bunny settles back into the meadow as the sun sets, the rodents defeated.',
    tags: ['ending', 'sunset', 'meadow', 'victory', 'calm'],
  },
];

const ELEPHANTS_TIMELINE = [
  {
    id: 'ed_001',
    ts: 8,
    type: 'beat',
    title: 'The machine',
    text: 'Two figures move through a vast, humming mechanical world of pipes and catwalks.',
    tags: ['opening', 'machine', 'pipes', 'catwalks', 'world'],
  },
  {
    id: 'ed_002',
    ts: 22,
    endTs: 654,
    type: 'character',
    character: 'Proog',
    text: 'Proog — the older guide who insists the machine is beautiful and dangerous.',
    tags: ['proog', 'guide', 'older', 'believer', 'machine'],
    priority: 'high',
  },
  {
    id: 'ed_003',
    ts: 26,
    endTs: 654,
    type: 'character',
    character: 'Emo',
    text: 'Emo — the younger man who follows Proog and begins to doubt everything he is shown.',
    tags: ['emo', 'younger', 'sceptic', 'doubt', 'follower'],
    priority: 'high',
  },
  {
    id: 'ed_004',
    ts: 55,
    type: 'trivia',
    text: "Elephants Dream was released in 2006 as the Blender Foundation's first open movie.",
    tags: ['2006', 'first', 'open movie', 'blender foundation', 'release'],
  },
  {
    id: 'ed_005',
    ts: 90,
    type: 'glossary',
    term: 'Open movie',
    definition:
      'A film produced with open-source tools whose assets and production files are publicly released.',
    tags: ['open movie', 'licence', 'blender', 'production'],
  },
  {
    id: 'ed_006',
    ts: 130,
    type: 'beat',
    title: 'The demonstration',
    text: "Proog demonstrates the machine's perils, stepping confidently across a moving walkway.",
    tags: ['machine', 'demonstration', 'walkway', 'danger', 'confidence'],
  },
  {
    id: 'ed_007',
    ts: 190,
    type: 'trivia',
    text: 'The film was directed by Bassam Kurdali, produced by Ton Roosendaal, and its script was developed collaboratively.',
    tags: ['director', 'bassam kurdali', 'producer', 'ton roosendaal', 'script'],
  },
  {
    id: 'ed_008',
    ts: 250,
    type: 'variation_point',
    variationKind: 'subtitle',
    title: "Choose the caption for Proog's warning",
    text: 'Authored caption alternatives for a single line.',
    tags: ['caption', 'subtitle', 'warning', 'proog', 'variant'],
    defaultOptionId: 'opt_en',
    options: [
      {
        id: 'opt_en',
        label: 'English',
        subtitle: { locale: 'en', text: 'Everything you see is held together by forces you cannot see.' },
      },
      {
        id: 'opt_es',
        label: 'Spanish',
        subtitle: { locale: 'es', text: 'Todo lo que ves se sostiene por fuerzas que no puedes ver.' },
      },
    ],
  },
  {
    id: 'ed_009',
    ts: 300,
    type: 'beat',
    title: 'Doubt',
    text: "Emo questions Proog, and the machine's geometry shifts around them as the argument escalates.",
    tags: ['argument', 'doubt', 'geometry', 'shifting', 'tension'],
  },
  {
    id: 'ed_010',
    ts: 360,
    type: 'trivia',
    text: "Elephants Dream was used as a production test for Blender's animation, rendering and compositing pipeline.",
    tags: ['production', 'test', 'pipeline', 'rendering', 'blender'],
  },
  {
    id: 'ed_011',
    ts: 430,
    type: 'glossary',
    term: 'Machinima',
    definition:
      'Animation produced inside a real-time 3D engine instead of being rendered offline frame by frame.',
    tags: ['machinima', 'realtime', 'engine', 'animation'],
  },
  {
    id: 'ed_012',
    ts: 500,
    type: 'beat',
    title: 'The bridge',
    text: "The pair reach a precarious bridge; Proog's certainty begins to crack.",
    tags: ['bridge', 'precarious', 'doubt', 'certainty', 'climax'],
  },
  {
    id: 'ed_013',
    ts: 560,
    type: 'variation_point',
    variationKind: 'narrative',
    title: 'Choose the closing framing',
    text: 'Two approved closing cards for the final shot.',
    tags: ['ending', 'framing', 'narration', 'variant'],
    defaultOptionId: 'opt_a',
    options: [
      {
        id: 'opt_a',
        label: 'The machine keeps running',
        subtitle: { locale: 'en', text: 'The machine keeps running, whether or not anyone believes in it.' },
      },
      {
        id: 'opt_b',
        label: 'No way back',
        subtitle: { locale: 'en', text: 'Two men, one machine, and no way back.' },
      },
    ],
  },
  {
    id: 'ed_014',
    ts: 610,
    type: 'trivia',
    text: 'The soundtrack was composed by Jan Morgenstern, who also scored later Blender open movies.',
    tags: ['soundtrack', 'composer', 'jan morgenstern', 'music'],
  },
  {
    id: 'ed_015',
    ts: 640,
    type: 'beat',
    title: 'Unresolved',
    text: 'The film ends on the machine still humming, the argument unresolved.',
    tags: ['ending', 'unresolved', 'machine', 'humming'],
  },
];

const BUNNY_EXCERPT_TIMELINE = [
  {
    id: 'bx_001',
    ts: 1,
    type: 'beat',
    title: 'Meadow excerpt',
    text: 'A ten-second excerpt of Big Buck Bunny used for fast synchronisation tests.',
    tags: ['excerpt', 'meadow', 'short', 'bunny'],
  },
  {
    id: 'bx_002',
    ts: 4,
    type: 'trivia',
    text: 'This excerpt is a ten-second cut of the open movie Big Buck Bunny, licensed Creative Commons Attribution 3.0.',
    tags: ['excerpt', 'creative commons', 'licence', 'open movie'],
  },
  {
    id: 'bx_003',
    ts: 7,
    type: 'variation_point',
    variationKind: 'subtitle',
    title: 'Choose the caption for the excerpt',
    text: 'Two approved captions for the meadow excerpt.',
    tags: ['caption', 'subtitle', 'excerpt', 'variant'],
    defaultOptionId: 'opt_en',
    options: [
      { id: 'opt_en', label: 'English', subtitle: { locale: 'en', text: 'A quiet meadow, for now.' } },
      { id: 'opt_es', label: 'Spanish', subtitle: { locale: 'es', text: 'Un prado tranquilo, por ahora.' } },
    ],
  },
];

const SINTEL_EXCERPT_TIMELINE = [
  {
    id: 'sx_001',
    ts: 1,
    type: 'beat',
    title: 'Ridge excerpt',
    text: "A ten-second excerpt of Sintel's snowbound opening, used for fast synchronisation tests.",
    tags: ['excerpt', 'snow', 'ridge', 'sintel', 'short'],
  },
  {
    id: 'sx_002',
    ts: 4,
    type: 'trivia',
    text: 'This excerpt is a ten-second cut of the open movie Sintel, licensed Creative Commons Attribution 3.0.',
    tags: ['excerpt', 'creative commons', 'licence', 'open movie', 'sintel'],
  },
  {
    id: 'sx_003',
    ts: 7,
    type: 'variation_point',
    variationKind: 'subtitle',
    title: 'Choose the caption for the excerpt',
    text: 'Two approved captions for the ridge excerpt.',
    tags: ['caption', 'subtitle', 'excerpt', 'variant'],
    defaultOptionId: 'opt_en',
    options: [
      { id: 'opt_en', label: 'English', subtitle: { locale: 'en', text: 'Look at the ridge.' } },
      { id: 'opt_es', label: 'Spanish', subtitle: { locale: 'es', text: 'Mira la cresta.' } },
    ],
  },
];

const DRIFT_TIMELINE = [
  {
    id: 'dr_001',
    ts: 1,
    type: 'beat',
    title: 'Drift',
    text: 'A jellyfish pulses through dark water in a ten-second nature clip.',
    tags: ['nature', 'ocean', 'jellyfish', 'short', 'documentary'],
  },
  {
    id: 'dr_002',
    ts: 4,
    type: 'glossary',
    term: 'Bitrate',
    definition:
      'The amount of data used per second of video; higher bitrates usually mean better image quality at the same resolution.',
    tags: ['bitrate', 'encoding', 'video', 'quality'],
  },
  {
    id: 'dr_003',
    ts: 7,
    type: 'trivia',
    text: 'This clip is a standard open test asset used to benchmark video encoders across resolutions.',
    tags: ['test asset', 'benchmark', 'encoder', 'open'],
  },
];

const TITLES = [
  {
    name: 'Sintel',
    slug: 'sintel',
    year: 2010,
    synopsis:
      'A lone hunter crosses a harsh world searching for the dragon she raised as a hatchling. A 2010 open movie from the Blender Institute, released under Creative Commons Attribution 3.0.',
    durationSeconds: 888,
    genres: ['Fantasy', 'Adventure', 'Animation'],
    videoAssetUrl: MEDIA.sintel,
    fallbackAssetUrl: MEDIA.sintelSample,
    posterUrl: POSTERS.sintel,
    accentColor: '#7f5af0',
    license: 'CC BY 3.0 — Blender Institute',
    timeline: SINTEL_TIMELINE,
    featured: true,
  },
  {
    name: 'Big Buck Bunny',
    slug: 'big-buck-bunny',
    year: 2008,
    synopsis:
      'A gentle giant of a rabbit turns the tables on three bullying rodents in a sunlit meadow. The Blender Institute’s second open movie.',
    durationSeconds: 596,
    genres: ['Comedy', 'Family', 'Animation'],
    videoAssetUrl: MEDIA.bigBuckBunny,
    fallbackAssetUrl: MEDIA.bunnySample,
    posterUrl: POSTERS.bigBuckBunny,
    accentColor: '#2cb67d',
    license: 'CC BY 3.0 — Blender Institute',
    timeline: BUNNY_TIMELINE,
    featured: true,
  },
  {
    name: 'Elephants Dream',
    slug: 'elephants-dream',
    year: 2006,
    synopsis:
      'Two men argue their way through an endless mechanical world. The first Blender open movie, and a landmark test of an open production pipeline.',
    durationSeconds: 654,
    genres: ['Sci-Fi', 'Experimental', 'Animation'],
    videoAssetUrl: MEDIA.elephantsDream,
    fallbackAssetUrl: MEDIA.genericSample,
    posterUrl: POSTERS.elephantsDream,
    accentColor: '#f2a33c',
    license: 'CC BY 3.0 — Blender Foundation',
    timeline: ELEPHANTS_TIMELINE,
    featured: true,
  },
  {
    name: 'Drift',
    slug: 'drift',
    year: 2024,
    synopsis: 'A ten-second nature short: a jellyfish pulses through dark water.',
    durationSeconds: 10,
    genres: ['Documentary', 'Nature', 'Short'],
    videoAssetUrl: MEDIA.jellyfish,
    posterUrl: POSTERS.drift,
    accentColor: '#3da9fc',
    license: 'Open test asset',
    timeline: DRIFT_TIMELINE,
    featured: false,
  },
  {
    name: 'The Ridge — Short',
    slug: 'the-ridge-short',
    year: 2024,
    synopsis:
      'A ten-second excerpt of Sintel’s snowbound opening, kept in the catalogue for fast synchronisation tests.',
    durationSeconds: 10,
    genres: ['Fantasy', 'Short', 'Animation'],
    videoAssetUrl: MEDIA.sintelExcerpt,
    posterUrl: POSTERS.ridgeShort,
    accentColor: '#8ea6ff',
    license: 'CC BY 3.0 — Blender Institute',
    timeline: SINTEL_EXCERPT_TIMELINE,
    featured: false,
  },
  {
    name: 'Meadow — Short',
    slug: 'meadow-short',
    year: 2024,
    synopsis:
      'A ten-second excerpt of Big Buck Bunny’s meadow, kept in the catalogue for fast synchronisation tests.',
    durationSeconds: 10,
    genres: ['Comedy', 'Family', 'Short'],
    videoAssetUrl: MEDIA.bunnyExcerpt,
    posterUrl: POSTERS.meadowShort,
    accentColor: '#7bd88f',
    license: 'CC BY 3.0 — Blender Institute',
    timeline: BUNNY_EXCERPT_TIMELINE,
    featured: false,
  },
];

const DEMO_USERS = [
  {
    email: 'admin@watchspaces.dev',
    displayName: 'Ava Admin',
    password: 'Admin123!',
    role: 'admin',
    genreAffinity: ['Fantasy', 'Sci-Fi'],
    key: 'admin',
  },
  {
    email: 'host@watchspaces.dev',
    displayName: 'Hari Host',
    password: 'Host123!',
    role: 'host',
    genreAffinity: ['Fantasy', 'Adventure'],
    key: 'host',
  },
  {
    email: 'viewer@watchspaces.dev',
    displayName: 'Vera Viewer',
    password: 'Viewer123!',
    role: 'viewer',
    genreAffinity: ['Comedy', 'Family'],
    key: 'viewer',
  },
  {
    email: 'maya@watchspaces.dev',
    displayName: 'Maya',
    password: 'Maya1234!',
    role: 'viewer',
    genreAffinity: ['Fantasy', 'Adventure'],
    key: 'maya',
    synthetic: true,
  },
  {
    email: 'dev@watchspaces.dev',
    displayName: 'Dev',
    password: 'Dev12345!',
    role: 'viewer',
    genreAffinity: ['Comedy', 'Family'],
    key: 'dev',
    synthetic: true,
  },
  {
    email: 'priya@watchspaces.dev',
    displayName: 'Priya',
    password: 'Priya1234!',
    role: 'viewer',
    genreAffinity: ['Fantasy', 'Animation'],
    key: 'priya',
    synthetic: true,
  },
  {
    email: 'jonas@watchspaces.dev',
    displayName: 'Jonas',
    password: 'Jonas1234!',
    role: 'viewer',
    genreAffinity: ['Sci-Fi', 'Experimental'],
    key: 'jonas',
    synthetic: true,
  },
  {
    email: 'leah@watchspaces.dev',
    displayName: 'Leah',
    password: 'Leah1234!',
    role: 'viewer',
    genreAffinity: ['Family', 'Comedy'],
    key: 'leah',
    synthetic: true,
  },
  {
    email: 'marco@watchspaces.dev',
    displayName: 'Marco',
    password: 'Marco1234!',
    role: 'viewer',
    genreAffinity: ['Documentary', 'Nature'],
    key: 'marco',
    synthetic: true,
  },
];

// Ordered chronologically per user: the last entry is each user's held-out
// interaction for the offline precision@5 evaluation.
const DEMO_INTERACTIONS = [
  { key: 'admin', slug: 'elephants-dream', rating: 4, completed: true },
  { key: 'admin', slug: 'sintel', rating: 5, completed: true },
  { key: 'admin', slug: 'the-ridge-short', rating: 5, completed: true },

  { key: 'host', slug: 'elephants-dream', rating: 4, completed: true },
  { key: 'host', slug: 'big-buck-bunny', rating: 4, completed: false, ratio: 0.5 },
  { key: 'host', slug: 'sintel', rating: 5, completed: true },

  { key: 'viewer', slug: 'sintel', rating: 3, completed: false, ratio: 0.6 },
  { key: 'viewer', slug: 'big-buck-bunny', rating: 4, completed: true },
  { key: 'viewer', slug: 'meadow-short', rating: 4, completed: true },

  { key: 'maya', slug: 'big-buck-bunny', rating: 3, completed: false, ratio: 0.4 },
  { key: 'maya', slug: 'elephants-dream', rating: 3, completed: true },
  { key: 'maya', slug: 'sintel', rating: 5, completed: true },

  { key: 'dev', slug: 'sintel', rating: 3, completed: false, ratio: 0.7 },
  { key: 'dev', slug: 'meadow-short', rating: 4, completed: true },
  { key: 'dev', slug: 'big-buck-bunny', rating: 5, completed: true },

  { key: 'priya', slug: 'elephants-dream', rating: 3, completed: false, ratio: 0.5 },
  { key: 'priya', slug: 'the-ridge-short', rating: 4, completed: true },
  { key: 'priya', slug: 'sintel', rating: 5, completed: true },

  { key: 'jonas', slug: 'sintel', rating: 4, completed: false, ratio: 0.8 },
  { key: 'jonas', slug: 'big-buck-bunny', rating: 3, completed: false, ratio: 0.3 },
  { key: 'jonas', slug: 'elephants-dream', rating: 5, completed: true },

  { key: 'leah', slug: 'drift', rating: 3, completed: true },
  { key: 'leah', slug: 'big-buck-bunny', rating: 5, completed: true },
  { key: 'leah', slug: 'meadow-short', rating: 4, completed: true },

  { key: 'marco', slug: 'meadow-short', rating: 3, completed: false, ratio: 0.5 },
  { key: 'marco', slug: 'big-buck-bunny', rating: 3, completed: false, ratio: 0.6 },
  { key: 'marco', slug: 'drift', rating: 5, completed: true },
];

module.exports = { TITLES, DEMO_USERS, DEMO_INTERACTIONS, MEDIA };
