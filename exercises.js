// RepForge exercise & equipment database.
// Equipment requirements: each entry in `eq` is either an id (required) or an
// array of ids (any one of them satisfies the requirement). Empty eq = bodyweight.

const EQUIPMENT_GROUPS = [
  {
    name: 'Free Weights',
    items: [
      { id: 'barbell',   name: 'Barbell & Plates',      icon: '🏋️' },
      { id: 'dumbbell',  name: 'Dumbbells',             icon: '💪' },
      { id: 'kettlebell',name: 'Kettlebells',           icon: '🫖' },
      { id: 'ez_bar',    name: 'EZ Curl Bar',           icon: '〰️' },
      { id: 'trap_bar',  name: 'Trap / Hex Bar',        icon: '⬡' },
    ],
  },
  {
    name: 'Benches, Racks & Bars',
    items: [
      { id: 'flat_bench',   name: 'Flat Bench',              icon: '🛋️' },
      { id: 'incline_bench',name: 'Adjustable / Incline Bench', icon: '📐' },
      { id: 'squat_rack',   name: 'Squat Rack / Power Cage', icon: '🗼' },
      { id: 'pullup_bar',   name: 'Pull-up Bar',             icon: '🚪' },
      { id: 'dip_station',  name: 'Dip Bars / Station',      icon: '🅿️' },
    ],
  },
  {
    name: 'Machines & Cables',
    items: [
      { id: 'cable',            name: 'Cable Machine / Crossover', icon: '🔗' },
      { id: 'lat_pulldown',     name: 'Lat Pulldown Machine',      icon: '⬇️' },
      { id: 'row_machine',      name: 'Seated Row Machine',        icon: '↔️' },
      { id: 'smith',            name: 'Smith Machine',             icon: '🏗️' },
      { id: 'leg_press',        name: 'Leg Press Machine',         icon: '🦵' },
      { id: 'hack_squat',       name: 'Hack Squat Machine',        icon: '📉' },
      { id: 'leg_extension',    name: 'Leg Extension Machine',     icon: '🪑' },
      { id: 'leg_curl',         name: 'Leg Curl Machine',          icon: '🪝' },
      { id: 'chest_press_machine', name: 'Chest Press Machine',    icon: '🎛️' },
      { id: 'pec_deck',         name: 'Pec Deck / Reverse Fly',    icon: '🦋' },
      { id: 'shoulder_press_machine', name: 'Shoulder Press Machine', icon: '🔺' },
      { id: 'calf_machine',     name: 'Calf Raise Machine',        icon: '🐄' },
    ],
  },
  {
    name: 'Other Gear',
    items: [
      { id: 'bands',      name: 'Resistance Bands',        icon: '➿' },
      { id: 'suspension', name: 'Suspension Trainer (TRX)',icon: '🪢' },
      { id: 'ab_wheel',   name: 'Ab Wheel',                icon: '☸️' },
      { id: 'plyo_box',   name: 'Plyo Box / Step',         icon: '📦' },
      { id: 'landmine',   name: 'Landmine Attachment',     icon: '⚓' },
    ],
  },
  {
    name: 'Cardio',
    items: [
      { id: 'treadmill', name: 'Treadmill',  icon: '🏃' },
      { id: 'bike',      name: 'Exercise Bike', icon: '🚴' },
      { id: 'rower',     name: 'Rowing Machine', icon: '🚣' },
      { id: 'jump_rope', name: 'Jump Rope',  icon: '🪅' },
    ],
  },
];

const EQUIPMENT_BY_ID = {};
EQUIPMENT_GROUPS.forEach(g => g.items.forEach(i => { EQUIPMENT_BY_ID[i.id] = i; }));

const EQUIPMENT_PRESETS = [
  {
    id: 'home_free',
    name: 'Home Gym — Free Weights',
    desc: 'Barbell, dumbbells, bench & rack. No machines.',
    ids: ['barbell', 'dumbbell', 'flat_bench', 'incline_bench', 'squat_rack', 'pullup_bar'],
  },
  {
    id: 'commercial',
    name: 'Commercial Gym — Everything',
    desc: 'All free weights, machines and cables.',
    ids: EQUIPMENT_GROUPS.flatMap(g => g.items.map(i => i.id)),
  },
  {
    id: 'dumbbell_only',
    name: 'Dumbbells Only',
    desc: 'A pair of dumbbells and not much else.',
    ids: ['dumbbell'],
  },
  {
    id: 'bodyweight',
    name: 'Bodyweight Only',
    desc: 'No equipment at all.',
    ids: [],
  },
];

// Muscle groups used for filtering.
const MUSCLES = ['Chest', 'Back', 'Shoulders', 'Biceps', 'Triceps', 'Quads', 'Hamstrings', 'Glutes', 'Calves', 'Core', 'Cardio'];

// t: 'wr' = weight x reps, 'r' = reps only, 't' = timed (seconds)
// p: movement pattern, used by smart templates to substitute exercises.
const EXERCISES = [
  // ===== Chest =====
  { id: 'bb_bench',        name: 'Barbell Bench Press',        m: 'Chest', sec: ['Triceps', 'Shoulders'], eq: ['barbell', ['flat_bench', 'incline_bench']], p: 'hpush', t: 'wr' },
  { id: 'bb_incline_bench',name: 'Incline Barbell Bench Press',m: 'Chest', sec: ['Shoulders', 'Triceps'], eq: ['barbell', 'incline_bench'], p: 'hpush', t: 'wr' },
  { id: 'db_bench',        name: 'Dumbbell Bench Press',       m: 'Chest', sec: ['Triceps', 'Shoulders'], eq: ['dumbbell', ['flat_bench', 'incline_bench']], p: 'hpush', t: 'wr' },
  { id: 'db_incline_bench',name: 'Incline Dumbbell Press',     m: 'Chest', sec: ['Shoulders', 'Triceps'], eq: ['dumbbell', 'incline_bench'], p: 'hpush', t: 'wr' },
  { id: 'db_floor_press',  name: 'Dumbbell Floor Press',       m: 'Chest', sec: ['Triceps'],              eq: ['dumbbell'], p: 'hpush', t: 'wr' },
  { id: 'bb_floor_press',  name: 'Barbell Floor Press',        m: 'Chest', sec: ['Triceps'],              eq: ['barbell'], p: 'hpush', t: 'wr' },
  { id: 'db_fly',          name: 'Dumbbell Fly',               m: 'Chest', sec: [],                       eq: ['dumbbell', ['flat_bench', 'incline_bench']], p: 'chest_iso', t: 'wr' },
  { id: 'cable_fly',       name: 'Cable Fly / Crossover',      m: 'Chest', sec: [],                       eq: ['cable'], p: 'chest_iso', t: 'wr' },
  { id: 'pec_deck_fly',    name: 'Pec Deck Fly',               m: 'Chest', sec: [],                       eq: ['pec_deck'], p: 'chest_iso', t: 'wr' },
  { id: 'machine_chest_press', name: 'Machine Chest Press',    m: 'Chest', sec: ['Triceps'],              eq: ['chest_press_machine'], p: 'hpush', t: 'wr' },
  { id: 'smith_bench',     name: 'Smith Machine Bench Press',  m: 'Chest', sec: ['Triceps'],              eq: ['smith', ['flat_bench', 'incline_bench']], p: 'hpush', t: 'wr' },
  { id: 'pushup',          name: 'Push-up',                    m: 'Chest', sec: ['Triceps', 'Shoulders'], eq: [], p: 'hpush', t: 'r' },
  { id: 'decline_pushup',  name: 'Decline Push-up',            m: 'Chest', sec: ['Shoulders'],            eq: [['plyo_box', 'flat_bench', 'incline_bench']], p: 'hpush', t: 'r' },
  { id: 'band_pushup',     name: 'Banded Push-up',             m: 'Chest', sec: ['Triceps'],              eq: ['bands'], p: 'hpush', t: 'r' },
  { id: 'chest_dip',       name: 'Chest Dip',                  m: 'Chest', sec: ['Triceps'],              eq: ['dip_station'], p: 'hpush', t: 'r' },
  { id: 'trx_chest_press', name: 'TRX Chest Press',            m: 'Chest', sec: ['Triceps', 'Core'],      eq: ['suspension'], p: 'hpush', t: 'r' },

  // ===== Back =====
  { id: 'deadlift',        name: 'Deadlift',                   m: 'Back', sec: ['Hamstrings', 'Glutes'],  eq: ['barbell'], p: 'hinge', t: 'wr' },
  { id: 'sumo_deadlift',   name: 'Sumo Deadlift',              m: 'Back', sec: ['Glutes', 'Quads'],       eq: ['barbell'], p: 'hinge', t: 'wr' },
  { id: 'trap_bar_deadlift', name: 'Trap Bar Deadlift',        m: 'Back', sec: ['Quads', 'Glutes'],       eq: ['trap_bar'], p: 'hinge', t: 'wr' },
  { id: 'rack_pull',       name: 'Rack Pull',                  m: 'Back', sec: ['Glutes'],                eq: ['barbell', 'squat_rack'], p: 'hinge', t: 'wr' },
  { id: 'pullup',          name: 'Pull-up',                    m: 'Back', sec: ['Biceps'],                eq: ['pullup_bar'], p: 'vpull', t: 'r' },
  { id: 'chinup',          name: 'Chin-up',                    m: 'Back', sec: ['Biceps'],                eq: ['pullup_bar'], p: 'vpull', t: 'r' },
  { id: 'lat_pulldown_ex', name: 'Lat Pulldown',               m: 'Back', sec: ['Biceps'],                eq: ['lat_pulldown'], p: 'vpull', t: 'wr' },
  { id: 'band_pulldown',   name: 'Band Lat Pulldown',          m: 'Back', sec: ['Biceps'],                eq: ['bands'], p: 'vpull', t: 'r' },
  { id: 'bb_row',          name: 'Barbell Row',                m: 'Back', sec: ['Biceps'],                eq: ['barbell'], p: 'hpull', t: 'wr' },
  { id: 'db_row',          name: 'One-Arm Dumbbell Row',       m: 'Back', sec: ['Biceps'],                eq: ['dumbbell'], p: 'hpull', t: 'wr' },
  { id: 'seated_cable_row',name: 'Seated Cable Row',           m: 'Back', sec: ['Biceps'],                eq: ['cable'], p: 'hpull', t: 'wr' },
  { id: 'machine_row',     name: 'Machine Row',                m: 'Back', sec: ['Biceps'],                eq: ['row_machine'], p: 'hpull', t: 'wr' },
  { id: 'tbar_row',        name: 'Landmine / T-Bar Row',       m: 'Back', sec: ['Biceps'],                eq: ['barbell', 'landmine'], p: 'hpull', t: 'wr' },
  { id: 'band_row',        name: 'Band Row',                   m: 'Back', sec: ['Biceps'],                eq: ['bands'], p: 'hpull', t: 'r' },
  { id: 'trx_row',         name: 'TRX Row',                    m: 'Back', sec: ['Biceps', 'Core'],        eq: ['suspension'], p: 'hpull', t: 'r' },
  { id: 'inverted_row',    name: 'Inverted Row',               m: 'Back', sec: ['Biceps'],                eq: [['squat_rack', 'smith']], p: 'hpull', t: 'r' },
  { id: 'straight_arm_pulldown', name: 'Straight-Arm Pulldown',m: 'Back', sec: [],                        eq: ['cable'], p: 'vpull', t: 'wr' },
  { id: 'db_pullover',     name: 'Dumbbell Pullover',          m: 'Back', sec: ['Chest'],                 eq: ['dumbbell', ['flat_bench', 'incline_bench']], p: 'vpull', t: 'wr' },
  { id: 'good_morning',    name: 'Good Morning',               m: 'Hamstrings', sec: ['Back', 'Glutes'],  eq: ['barbell'], p: 'hinge', t: 'wr' },
  { id: 'bb_shrug',        name: 'Barbell Shrug',              m: 'Back', sec: [],                        eq: ['barbell'], p: 'shrug', t: 'wr' },
  { id: 'db_shrug',        name: 'Dumbbell Shrug',             m: 'Back', sec: [],                        eq: ['dumbbell'], p: 'shrug', t: 'wr' },

  // ===== Shoulders =====
  { id: 'ohp',             name: 'Overhead Press (Barbell)',   m: 'Shoulders', sec: ['Triceps'],          eq: ['barbell'], p: 'vpush', t: 'wr' },
  { id: 'push_press',      name: 'Push Press',                 m: 'Shoulders', sec: ['Triceps', 'Quads'], eq: ['barbell'], p: 'vpush', t: 'wr' },
  { id: 'db_shoulder_press', name: 'Dumbbell Shoulder Press',  m: 'Shoulders', sec: ['Triceps'],          eq: ['dumbbell'], p: 'vpush', t: 'wr' },
  { id: 'seated_db_press', name: 'Seated Dumbbell Press',      m: 'Shoulders', sec: ['Triceps'],          eq: ['dumbbell', 'incline_bench'], p: 'vpush', t: 'wr' },
  { id: 'arnold_press',    name: 'Arnold Press',               m: 'Shoulders', sec: ['Triceps'],          eq: ['dumbbell'], p: 'vpush', t: 'wr' },
  { id: 'machine_shoulder_press', name: 'Machine Shoulder Press', m: 'Shoulders', sec: ['Triceps'],       eq: ['shoulder_press_machine'], p: 'vpush', t: 'wr' },
  { id: 'smith_ohp',       name: 'Smith Machine Overhead Press', m: 'Shoulders', sec: ['Triceps'],        eq: ['smith'], p: 'vpush', t: 'wr' },
  { id: 'landmine_press',  name: 'Landmine Press',             m: 'Shoulders', sec: ['Chest', 'Triceps'], eq: ['barbell', 'landmine'], p: 'vpush', t: 'wr' },
  { id: 'pike_pushup',     name: 'Pike Push-up',               m: 'Shoulders', sec: ['Triceps'],          eq: [], p: 'vpush', t: 'r' },
  { id: 'hspu',            name: 'Handstand Push-up',          m: 'Shoulders', sec: ['Triceps'],          eq: [], p: 'vpush', t: 'r' },
  { id: 'lateral_raise',   name: 'Dumbbell Lateral Raise',     m: 'Shoulders', sec: [],                   eq: ['dumbbell'], p: 'side', t: 'wr' },
  { id: 'cable_lateral_raise', name: 'Cable Lateral Raise',    m: 'Shoulders', sec: [],                   eq: ['cable'], p: 'side', t: 'wr' },
  { id: 'band_lateral_raise', name: 'Band Lateral Raise',      m: 'Shoulders', sec: [],                   eq: ['bands'], p: 'side', t: 'r' },
  { id: 'front_raise',     name: 'Front Raise',                m: 'Shoulders', sec: [],                   eq: ['dumbbell'], p: 'side', t: 'wr' },
  { id: 'rear_delt_fly',   name: 'Rear Delt Fly (Dumbbell)',   m: 'Shoulders', sec: ['Back'],             eq: ['dumbbell'], p: 'rear', t: 'wr' },
  { id: 'reverse_pec_deck',name: 'Reverse Pec Deck',           m: 'Shoulders', sec: ['Back'],             eq: ['pec_deck'], p: 'rear', t: 'wr' },
  { id: 'face_pull',       name: 'Cable Face Pull',            m: 'Shoulders', sec: ['Back'],             eq: ['cable'], p: 'rear', t: 'wr' },
  { id: 'band_face_pull',  name: 'Band Face Pull',             m: 'Shoulders', sec: ['Back'],             eq: ['bands'], p: 'rear', t: 'r' },
  { id: 'upright_row',     name: 'Upright Row',                m: 'Shoulders', sec: ['Back'],             eq: [['barbell', 'ez_bar', 'dumbbell']], p: 'side', t: 'wr' },

  // ===== Biceps =====
  { id: 'bb_curl',         name: 'Barbell Curl',               m: 'Biceps', sec: ['Forearms'],            eq: ['barbell'], p: 'curl', t: 'wr' },
  { id: 'ez_curl',         name: 'EZ Bar Curl',                m: 'Biceps', sec: ['Forearms'],            eq: ['ez_bar'], p: 'curl', t: 'wr' },
  { id: 'db_curl',         name: 'Dumbbell Curl',              m: 'Biceps', sec: [],                      eq: ['dumbbell'], p: 'curl', t: 'wr' },
  { id: 'hammer_curl',     name: 'Hammer Curl',                m: 'Biceps', sec: ['Forearms'],            eq: ['dumbbell'], p: 'curl', t: 'wr' },
  { id: 'incline_db_curl', name: 'Incline Dumbbell Curl',      m: 'Biceps', sec: [],                      eq: ['dumbbell', 'incline_bench'], p: 'curl', t: 'wr' },
  { id: 'preacher_curl',   name: 'Preacher Curl',              m: 'Biceps', sec: [],                      eq: [['ez_bar', 'dumbbell'], 'incline_bench'], p: 'curl', t: 'wr' },
  { id: 'concentration_curl', name: 'Concentration Curl',      m: 'Biceps', sec: [],                      eq: ['dumbbell'], p: 'curl', t: 'wr' },
  { id: 'cable_curl',      name: 'Cable Curl',                 m: 'Biceps', sec: [],                      eq: ['cable'], p: 'curl', t: 'wr' },
  { id: 'band_curl',       name: 'Band Curl',                  m: 'Biceps', sec: [],                      eq: ['bands'], p: 'curl', t: 'r' },
  { id: 'kb_curl',         name: 'Kettlebell Curl',            m: 'Biceps', sec: ['Forearms'],            eq: ['kettlebell'], p: 'curl', t: 'wr' },

  // ===== Triceps =====
  { id: 'cgbp',            name: 'Close-Grip Bench Press',     m: 'Triceps', sec: ['Chest'],              eq: ['barbell', ['flat_bench', 'incline_bench']], p: 'tri', t: 'wr' },
  { id: 'skullcrusher',    name: 'Skullcrusher',               m: 'Triceps', sec: [],                     eq: [['ez_bar', 'barbell', 'dumbbell'], ['flat_bench', 'incline_bench']], p: 'tri', t: 'wr' },
  { id: 'db_overhead_ext', name: 'Overhead Triceps Extension', m: 'Triceps', sec: [],                     eq: ['dumbbell'], p: 'tri', t: 'wr' },
  { id: 'cable_pushdown',  name: 'Cable Triceps Pushdown',     m: 'Triceps', sec: [],                     eq: ['cable'], p: 'tri', t: 'wr' },
  { id: 'cable_overhead_ext', name: 'Cable Overhead Extension',m: 'Triceps', sec: [],                     eq: ['cable'], p: 'tri', t: 'wr' },
  { id: 'band_pushdown',   name: 'Band Pushdown',              m: 'Triceps', sec: [],                     eq: ['bands'], p: 'tri', t: 'r' },
  { id: 'triceps_dip',     name: 'Triceps Dip',                m: 'Triceps', sec: ['Chest'],              eq: ['dip_station'], p: 'tri', t: 'r' },
  { id: 'bench_dip',       name: 'Bench Dip',                  m: 'Triceps', sec: [],                     eq: [['flat_bench', 'incline_bench', 'plyo_box']], p: 'tri', t: 'r' },
  { id: 'diamond_pushup',  name: 'Diamond Push-up',            m: 'Triceps', sec: ['Chest'],              eq: [], p: 'tri', t: 'r' },
  { id: 'db_kickback',     name: 'Dumbbell Kickback',          m: 'Triceps', sec: [],                     eq: ['dumbbell'], p: 'tri', t: 'wr' },

  // ===== Legs =====
  { id: 'squat',           name: 'Barbell Back Squat',         m: 'Quads', sec: ['Glutes', 'Hamstrings'], eq: ['barbell', 'squat_rack'], p: 'squat', t: 'wr' },
  { id: 'front_squat',     name: 'Front Squat',                m: 'Quads', sec: ['Glutes', 'Core'],       eq: ['barbell', 'squat_rack'], p: 'squat', t: 'wr' },
  { id: 'smith_squat',     name: 'Smith Machine Squat',        m: 'Quads', sec: ['Glutes'],               eq: ['smith'], p: 'squat', t: 'wr' },
  { id: 'goblet_squat',    name: 'Goblet Squat',               m: 'Quads', sec: ['Glutes', 'Core'],       eq: [['dumbbell', 'kettlebell']], p: 'squat', t: 'wr' },
  { id: 'leg_press_ex',    name: 'Leg Press',                  m: 'Quads', sec: ['Glutes'],               eq: ['leg_press'], p: 'squat', t: 'wr' },
  { id: 'hack_squat_ex',   name: 'Hack Squat',                 m: 'Quads', sec: ['Glutes'],               eq: ['hack_squat'], p: 'squat', t: 'wr' },
  { id: 'bw_squat',        name: 'Bodyweight Squat',           m: 'Quads', sec: ['Glutes'],               eq: [], p: 'squat', t: 'r' },
  { id: 'pistol_squat',    name: 'Pistol Squat',               m: 'Quads', sec: ['Glutes', 'Core'],       eq: [], p: 'squat', t: 'r' },
  { id: 'bulgarian_split', name: 'Bulgarian Split Squat',      m: 'Quads', sec: ['Glutes'],               eq: [['flat_bench', 'incline_bench', 'plyo_box']], p: 'lunge', t: 'wr' },
  { id: 'walking_lunge',   name: 'Dumbbell Walking Lunge',     m: 'Quads', sec: ['Glutes'],               eq: ['dumbbell'], p: 'lunge', t: 'wr' },
  { id: 'bw_lunge',        name: 'Bodyweight Lunge',           m: 'Quads', sec: ['Glutes'],               eq: [], p: 'lunge', t: 'r' },
  { id: 'step_up',         name: 'Step-up',                    m: 'Quads', sec: ['Glutes'],               eq: [['plyo_box', 'flat_bench']], p: 'lunge', t: 'wr' },
  { id: 'box_jump',        name: 'Box Jump',                   m: 'Quads', sec: ['Calves'],               eq: ['plyo_box'], p: 'lunge', t: 'r' },
  { id: 'rdl',             name: 'Romanian Deadlift (Barbell)',m: 'Hamstrings', sec: ['Glutes', 'Back'],  eq: ['barbell'], p: 'hinge', t: 'wr' },
  { id: 'db_rdl',          name: 'Dumbbell Romanian Deadlift', m: 'Hamstrings', sec: ['Glutes'],          eq: ['dumbbell'], p: 'hinge', t: 'wr' },
  { id: 'kb_swing',        name: 'Kettlebell Swing',           m: 'Hamstrings', sec: ['Glutes', 'Core'],  eq: ['kettlebell'], p: 'hinge', t: 'wr' },
  { id: 'leg_curl_ex',     name: 'Leg Curl (Machine)',         m: 'Hamstrings', sec: [],                  eq: ['leg_curl'], p: 'ham_iso', t: 'wr' },
  { id: 'leg_extension_ex',name: 'Leg Extension (Machine)',    m: 'Quads', sec: [],                       eq: ['leg_extension'], p: 'quad_iso', t: 'wr' },
  { id: 'hip_thrust',      name: 'Barbell Hip Thrust',         m: 'Glutes', sec: ['Hamstrings'],          eq: ['barbell', ['flat_bench', 'incline_bench']], p: 'glute', t: 'wr' },
  { id: 'glute_bridge',    name: 'Glute Bridge',               m: 'Glutes', sec: ['Hamstrings'],          eq: [], p: 'glute', t: 'r' },
  { id: 'single_leg_glute_bridge', name: 'Single-Leg Glute Bridge', m: 'Glutes', sec: ['Hamstrings'],     eq: [], p: 'glute', t: 'r' },
  { id: 'standing_calf',   name: 'Standing Calf Raise',        m: 'Calves', sec: [],                      eq: [], p: 'calf', t: 'r' },
  { id: 'db_calf',         name: 'Dumbbell Calf Raise',        m: 'Calves', sec: [],                      eq: ['dumbbell'], p: 'calf', t: 'wr' },
  { id: 'machine_calf',    name: 'Machine Calf Raise',         m: 'Calves', sec: [],                      eq: ['calf_machine'], p: 'calf', t: 'wr' },

  // ===== Core =====
  { id: 'plank',           name: 'Plank',                      m: 'Core', sec: [],                        eq: [], p: 'core', t: 't' },
  { id: 'side_plank',      name: 'Side Plank',                 m: 'Core', sec: [],                        eq: [], p: 'core', t: 't' },
  { id: 'crunch',          name: 'Crunch',                     m: 'Core', sec: [],                        eq: [], p: 'core', t: 'r' },
  { id: 'situp',           name: 'Sit-up',                     m: 'Core', sec: [],                        eq: [], p: 'core', t: 'r' },
  { id: 'bicycle_crunch',  name: 'Bicycle Crunch',             m: 'Core', sec: [],                        eq: [], p: 'core', t: 'r' },
  { id: 'lying_leg_raise', name: 'Lying Leg Raise',            m: 'Core', sec: [],                        eq: [], p: 'core', t: 'r' },
  { id: 'hanging_knee_raise', name: 'Hanging Knee Raise',      m: 'Core', sec: [],                        eq: ['pullup_bar'], p: 'core', t: 'r' },
  { id: 'hanging_leg_raise', name: 'Hanging Leg Raise',        m: 'Core', sec: [],                        eq: ['pullup_bar'], p: 'core', t: 'r' },
  { id: 'ab_wheel_rollout',name: 'Ab Wheel Rollout',           m: 'Core', sec: [],                        eq: ['ab_wheel'], p: 'core', t: 'r' },
  { id: 'cable_crunch',    name: 'Cable Crunch',               m: 'Core', sec: [],                        eq: ['cable'], p: 'core', t: 'wr' },
  { id: 'russian_twist',   name: 'Russian Twist',              m: 'Core', sec: [],                        eq: [], p: 'core', t: 'r' },
  { id: 'pallof_press',    name: 'Pallof Press',               m: 'Core', sec: [],                        eq: [['cable', 'bands']], p: 'core', t: 'r' },
  { id: 'mountain_climber',name: 'Mountain Climbers',          m: 'Core', sec: ['Cardio'],                eq: [], p: 'core', t: 't' },
  { id: 'dead_bug',        name: 'Dead Bug',                   m: 'Core', sec: [],                        eq: [], p: 'core', t: 'r' },

  // ===== Cardio =====
  { id: 'run_outdoor',     name: 'Running (Outdoor)',          m: 'Cardio', sec: [],                      eq: [], p: 'cardio', t: 't' },
  { id: 'treadmill_run',   name: 'Treadmill Run',              m: 'Cardio', sec: [],                      eq: ['treadmill'], p: 'cardio', t: 't' },
  { id: 'cycling',         name: 'Exercise Bike',              m: 'Cardio', sec: [],                      eq: ['bike'], p: 'cardio', t: 't' },
  { id: 'rowing',          name: 'Rowing Machine',             m: 'Cardio', sec: [],                      eq: ['rower'], p: 'cardio', t: 't' },
  { id: 'jump_rope_ex',    name: 'Jump Rope',                  m: 'Cardio', sec: ['Calves'],              eq: ['jump_rope'], p: 'cardio', t: 't' },
  { id: 'burpee',          name: 'Burpees',                    m: 'Cardio', sec: ['Chest', 'Quads'],      eq: [], p: 'cardio', t: 'r' },
];

const EXERCISE_BY_ID = {};
EXERCISES.forEach(e => { EXERCISE_BY_ID[e.id] = e; });

// Smart routine templates. Each slot names a movement pattern, a preferred
// exercise order, and set/rep targets. The app resolves each slot to the best
// exercise the user's equipment allows.
const ROUTINE_TEMPLATES = [
  {
    id: 'full_body_3',
    name: 'Full Body 3×/week',
    desc: 'Three balanced full-body days. Great starting point.',
    days: [
      {
        name: 'Full Body A',
        slots: [
          { p: 'squat', sets: 3, reps: '5-8',   prefer: ['squat', 'leg_press_ex', 'hack_squat_ex', 'goblet_squat', 'smith_squat', 'bw_squat'] },
          { p: 'hpush', sets: 3, reps: '5-8',   prefer: ['bb_bench', 'db_bench', 'machine_chest_press', 'smith_bench', 'db_floor_press', 'pushup'] },
          { p: 'hpull', sets: 3, reps: '8-10',  prefer: ['bb_row', 'seated_cable_row', 'machine_row', 'db_row', 'band_row', 'inverted_row'] },
          { p: 'side',  sets: 3, reps: '12-15', prefer: ['lateral_raise', 'cable_lateral_raise', 'band_lateral_raise'] },
          { p: 'core',  sets: 3, reps: '10-15', prefer: ['ab_wheel_rollout', 'hanging_knee_raise', 'cable_crunch', 'crunch'] },
        ],
      },
      {
        name: 'Full Body B',
        slots: [
          { p: 'hinge', sets: 3, reps: '5-8',   prefer: ['deadlift', 'trap_bar_deadlift', 'rdl', 'db_rdl', 'kb_swing'] },
          { p: 'vpush', sets: 3, reps: '6-10',  prefer: ['ohp', 'db_shoulder_press', 'machine_shoulder_press', 'smith_ohp', 'landmine_press', 'pike_pushup'] },
          { p: 'vpull', sets: 3, reps: '6-12',  prefer: ['pullup', 'lat_pulldown_ex', 'band_pulldown', 'db_pullover'] },
          { p: 'curl',  sets: 3, reps: '10-12', prefer: ['bb_curl', 'ez_curl', 'db_curl', 'cable_curl', 'band_curl'] },
          { p: 'core',  sets: 3, reps: '30-60s',prefer: ['plank', 'side_plank', 'dead_bug'] },
        ],
      },
      {
        name: 'Full Body C',
        slots: [
          { p: 'lunge', sets: 3, reps: '8-12',  prefer: ['bulgarian_split', 'walking_lunge', 'step_up', 'bw_lunge'] },
          { p: 'hpush', sets: 3, reps: '8-12',  prefer: ['db_incline_bench', 'bb_incline_bench', 'db_bench', 'machine_chest_press', 'pushup'] },
          { p: 'hpull', sets: 3, reps: '8-12',  prefer: ['db_row', 'seated_cable_row', 'bb_row', 'trx_row', 'band_row'] },
          { p: 'tri',   sets: 3, reps: '10-15', prefer: ['cable_pushdown', 'skullcrusher', 'db_overhead_ext', 'bench_dip', 'diamond_pushup'] },
          { p: 'calf',  sets: 3, reps: '12-20', prefer: ['machine_calf', 'db_calf', 'standing_calf'] },
        ],
      },
    ],
  },
  {
    id: 'upper_lower',
    name: 'Upper / Lower Split',
    desc: 'Four days: two upper-body, two lower-body.',
    days: [
      {
        name: 'Upper 1 (Strength)',
        slots: [
          { p: 'hpush', sets: 4, reps: '4-6',   prefer: ['bb_bench', 'db_bench', 'machine_chest_press', 'smith_bench', 'pushup'] },
          { p: 'hpull', sets: 4, reps: '5-8',   prefer: ['bb_row', 'machine_row', 'seated_cable_row', 'db_row', 'band_row'] },
          { p: 'vpush', sets: 3, reps: '6-8',   prefer: ['ohp', 'db_shoulder_press', 'machine_shoulder_press', 'smith_ohp', 'pike_pushup'] },
          { p: 'vpull', sets: 3, reps: '6-10',  prefer: ['pullup', 'lat_pulldown_ex', 'band_pulldown', 'db_pullover'] },
          { p: 'curl',  sets: 2, reps: '8-12',  prefer: ['bb_curl', 'ez_curl', 'db_curl', 'cable_curl', 'band_curl'] },
          { p: 'tri',   sets: 2, reps: '8-12',  prefer: ['cgbp', 'skullcrusher', 'cable_pushdown', 'db_overhead_ext', 'diamond_pushup'] },
        ],
      },
      {
        name: 'Lower 1 (Strength)',
        slots: [
          { p: 'squat', sets: 4, reps: '4-6',   prefer: ['squat', 'leg_press_ex', 'hack_squat_ex', 'smith_squat', 'goblet_squat', 'bw_squat'] },
          { p: 'hinge', sets: 3, reps: '6-8',   prefer: ['rdl', 'db_rdl', 'good_morning', 'kb_swing', 'glute_bridge'] },
          { p: 'lunge', sets: 3, reps: '8-10',  prefer: ['bulgarian_split', 'walking_lunge', 'step_up', 'bw_lunge'] },
          { p: 'calf',  sets: 4, reps: '10-15', prefer: ['machine_calf', 'db_calf', 'standing_calf'] },
          { p: 'core',  sets: 3, reps: '10-15', prefer: ['hanging_leg_raise', 'ab_wheel_rollout', 'cable_crunch', 'lying_leg_raise'] },
        ],
      },
      {
        name: 'Upper 2 (Volume)',
        slots: [
          { p: 'hpush', sets: 3, reps: '8-12',  prefer: ['db_incline_bench', 'bb_incline_bench', 'db_bench', 'machine_chest_press', 'decline_pushup', 'pushup'] },
          { p: 'hpull', sets: 3, reps: '8-12',  prefer: ['db_row', 'seated_cable_row', 'tbar_row', 'trx_row', 'band_row'] },
          { p: 'chest_iso', sets: 3, reps: '12-15', prefer: ['cable_fly', 'pec_deck_fly', 'db_fly', 'band_pushup'] },
          { p: 'side',  sets: 3, reps: '12-20', prefer: ['lateral_raise', 'cable_lateral_raise', 'band_lateral_raise'] },
          { p: 'rear',  sets: 3, reps: '12-20', prefer: ['face_pull', 'reverse_pec_deck', 'rear_delt_fly', 'band_face_pull'] },
          { p: 'curl',  sets: 3, reps: '10-15', prefer: ['hammer_curl', 'incline_db_curl', 'cable_curl', 'db_curl', 'band_curl'] },
        ],
      },
      {
        name: 'Lower 2 (Volume)',
        slots: [
          { p: 'hinge', sets: 4, reps: '5-8',   prefer: ['deadlift', 'trap_bar_deadlift', 'rdl', 'db_rdl', 'kb_swing'] },
          { p: 'squat', sets: 3, reps: '8-12',  prefer: ['front_squat', 'goblet_squat', 'leg_press_ex', 'hack_squat_ex', 'bw_squat'] },
          { p: 'glute', sets: 3, reps: '8-12',  prefer: ['hip_thrust', 'glute_bridge', 'single_leg_glute_bridge'] },
          { p: 'ham_iso', sets: 3, reps: '10-15', prefer: ['leg_curl_ex', 'db_rdl', 'good_morning', 'kb_swing'] },
          { p: 'calf',  sets: 4, reps: '12-20', prefer: ['machine_calf', 'db_calf', 'standing_calf'] },
        ],
      },
    ],
  },
  {
    id: 'ppl',
    name: 'Push / Pull / Legs',
    desc: 'The classic 3- or 6-day split.',
    days: [
      {
        name: 'Push Day',
        slots: [
          { p: 'hpush', sets: 4, reps: '5-8',   prefer: ['bb_bench', 'db_bench', 'machine_chest_press', 'smith_bench', 'pushup'] },
          { p: 'vpush', sets: 3, reps: '6-10',  prefer: ['ohp', 'seated_db_press', 'db_shoulder_press', 'machine_shoulder_press', 'pike_pushup'] },
          { p: 'hpush', sets: 3, reps: '8-12',  prefer: ['db_incline_bench', 'bb_incline_bench', 'chest_dip', 'decline_pushup'] },
          { p: 'side',  sets: 3, reps: '12-15', prefer: ['lateral_raise', 'cable_lateral_raise', 'band_lateral_raise'] },
          { p: 'tri',   sets: 3, reps: '10-15', prefer: ['cable_pushdown', 'skullcrusher', 'db_overhead_ext', 'bench_dip', 'diamond_pushup'] },
        ],
      },
      {
        name: 'Pull Day',
        slots: [
          { p: 'hinge', sets: 3, reps: '5',     prefer: ['deadlift', 'trap_bar_deadlift', 'rdl', 'db_rdl'] },
          { p: 'vpull', sets: 3, reps: '6-12',  prefer: ['pullup', 'lat_pulldown_ex', 'band_pulldown', 'db_pullover'] },
          { p: 'hpull', sets: 3, reps: '8-12',  prefer: ['bb_row', 'seated_cable_row', 'machine_row', 'db_row', 'band_row'] },
          { p: 'rear',  sets: 3, reps: '12-20', prefer: ['face_pull', 'reverse_pec_deck', 'rear_delt_fly', 'band_face_pull'] },
          { p: 'curl',  sets: 3, reps: '8-12',  prefer: ['bb_curl', 'ez_curl', 'db_curl', 'cable_curl', 'band_curl'] },
          { p: 'curl',  sets: 2, reps: '10-15', prefer: ['hammer_curl', 'incline_db_curl', 'concentration_curl', 'band_curl'] },
        ],
      },
      {
        name: 'Leg Day',
        slots: [
          { p: 'squat', sets: 4, reps: '5-8',   prefer: ['squat', 'leg_press_ex', 'hack_squat_ex', 'smith_squat', 'goblet_squat', 'bw_squat'] },
          { p: 'hinge', sets: 3, reps: '8-10',  prefer: ['rdl', 'db_rdl', 'good_morning', 'kb_swing'] },
          { p: 'lunge', sets: 3, reps: '8-12',  prefer: ['bulgarian_split', 'walking_lunge', 'step_up', 'bw_lunge'] },
          { p: 'ham_iso', sets: 3, reps: '10-15', prefer: ['leg_curl_ex', 'kb_swing', 'single_leg_glute_bridge'] },
          { p: 'calf',  sets: 4, reps: '10-20', prefer: ['machine_calf', 'db_calf', 'standing_calf'] },
          { p: 'core',  sets: 3, reps: '10-15', prefer: ['hanging_leg_raise', 'ab_wheel_rollout', 'lying_leg_raise', 'crunch'] },
        ],
      },
    ],
  },
  {
    id: 'minimal_home',
    name: 'Minimal Equipment / Home',
    desc: 'Two alternating days built for little or no gear.',
    days: [
      {
        name: 'Home Day A',
        slots: [
          { p: 'squat', sets: 4, reps: '10-15', prefer: ['goblet_squat', 'bw_squat', 'pistol_squat'] },
          { p: 'hpush', sets: 4, reps: '8-15',  prefer: ['db_bench', 'db_floor_press', 'pushup', 'band_pushup'] },
          { p: 'hpull', sets: 4, reps: '8-15',  prefer: ['db_row', 'band_row', 'trx_row', 'inverted_row'] },
          { p: 'glute', sets: 3, reps: '10-15', prefer: ['hip_thrust', 'glute_bridge', 'single_leg_glute_bridge'] },
          { p: 'core',  sets: 3, reps: '30-60s',prefer: ['plank', 'mountain_climber', 'dead_bug'] },
        ],
      },
      {
        name: 'Home Day B',
        slots: [
          { p: 'hinge', sets: 4, reps: '10-12', prefer: ['db_rdl', 'kb_swing', 'good_morning', 'glute_bridge'] },
          { p: 'vpush', sets: 4, reps: '8-12',  prefer: ['db_shoulder_press', 'pike_pushup', 'landmine_press', 'hspu'] },
          { p: 'vpull', sets: 3, reps: '6-12',  prefer: ['pullup', 'chinup', 'band_pulldown', 'db_pullover'] },
          { p: 'lunge', sets: 3, reps: '10-12', prefer: ['walking_lunge', 'bw_lunge', 'step_up', 'bulgarian_split'] },
          { p: 'core',  sets: 3, reps: '10-20', prefer: ['lying_leg_raise', 'bicycle_crunch', 'russian_twist'] },
        ],
      },
    ],
  },
];

// Ordered exercise preferences per movement pattern (compounds/best options first).
// Used by the workout generator to pick the best exercise the user's gear allows.
const PATTERN_PREFER = {
  hpush: ['bb_bench', 'db_bench', 'machine_chest_press', 'smith_bench', 'bb_incline_bench', 'db_incline_bench', 'chest_dip', 'db_floor_press', 'bb_floor_press', 'trx_chest_press', 'pushup', 'band_pushup', 'decline_pushup'],
  chest_iso: ['cable_fly', 'pec_deck_fly', 'db_fly', 'band_pushup'],
  hpull: ['bb_row', 'seated_cable_row', 'machine_row', 'db_row', 'tbar_row', 'trx_row', 'inverted_row', 'band_row'],
  vpull: ['pullup', 'lat_pulldown_ex', 'chinup', 'band_pulldown', 'straight_arm_pulldown', 'db_pullover'],
  vpush: ['ohp', 'db_shoulder_press', 'seated_db_press', 'machine_shoulder_press', 'smith_ohp', 'arnold_press', 'push_press', 'landmine_press', 'pike_pushup', 'hspu'],
  side: ['lateral_raise', 'cable_lateral_raise', 'upright_row', 'band_lateral_raise', 'front_raise'],
  rear: ['face_pull', 'reverse_pec_deck', 'rear_delt_fly', 'band_face_pull'],
  curl: ['bb_curl', 'ez_curl', 'db_curl', 'hammer_curl', 'cable_curl', 'incline_db_curl', 'preacher_curl', 'concentration_curl', 'band_curl', 'kb_curl'],
  tri: ['cgbp', 'cable_pushdown', 'skullcrusher', 'db_overhead_ext', 'triceps_dip', 'cable_overhead_ext', 'bench_dip', 'db_kickback', 'band_pushdown', 'diamond_pushup'],
  squat: ['squat', 'front_squat', 'leg_press_ex', 'hack_squat_ex', 'smith_squat', 'goblet_squat', 'bw_squat', 'pistol_squat'],
  hinge: ['deadlift', 'trap_bar_deadlift', 'rdl', 'db_rdl', 'good_morning', 'kb_swing', 'rack_pull', 'sumo_deadlift'],
  lunge: ['bulgarian_split', 'walking_lunge', 'step_up', 'bw_lunge', 'box_jump'],
  glute: ['hip_thrust', 'glute_bridge', 'single_leg_glute_bridge'],
  calf: ['machine_calf', 'db_calf', 'standing_calf'],
  core: ['hanging_leg_raise', 'ab_wheel_rollout', 'cable_crunch', 'plank', 'hanging_knee_raise', 'lying_leg_raise', 'russian_twist', 'crunch', 'bicycle_crunch', 'dead_bug', 'side_plank', 'pallof_press', 'situp', 'mountain_climber'],
  shrug: ['bb_shrug', 'db_shrug'],
  ham_iso: ['leg_curl_ex', 'db_rdl', 'good_morning', 'kb_swing'],
  quad_iso: ['leg_extension_ex'],
};

// Muscle groups the user can pick for auto-generated workouts, with the
// movement patterns each cycles through. Order here also pairs groups into
// rotation days (Chest+Triceps, Back+Biceps, ...).
const GROUP_DEFS = [
  { id: 'Chest',     icon: '🫁', patterns: ['hpush', 'hpush', 'chest_iso'] },
  { id: 'Triceps',   icon: '🔱', patterns: ['tri', 'tri'] },
  { id: 'Back',      icon: '🪽', patterns: ['hpull', 'vpull', 'hpull'] },
  { id: 'Biceps',    icon: '💪', patterns: ['curl', 'curl'] },
  { id: 'Shoulders', icon: '🏔️', patterns: ['vpush', 'side', 'rear'] },
  { id: 'Core',      icon: '🎯', patterns: ['core', 'core'] },
  { id: 'Legs',      icon: '🦵', patterns: ['squat', 'hinge', 'lunge', 'calf'] },
  { id: 'Glutes',    icon: '🍑', patterns: ['glute', 'hinge', 'lunge'] },
];
