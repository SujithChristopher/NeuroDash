// Active: account created, no training yet. Ongoing: devices allocated and at least one session trained (set
// automatically when device data arrives). The rest are chosen by the therapist.
export const PATIENT_STATUSES = [
	'Active',
	'Ongoing',
	'Paused',
	'Completed',
	'Discontinued'
] as const;

export const PLAN_STATUSES = ['Active', 'Paused', 'Completed', 'Discontinued'] as const;

export const DIAGNOSES = [
	{ label: 'Ischemic Stroke — Right MCA territory', side: 'Left' },
	{ label: 'Ischemic Stroke — Left MCA territory', side: 'Right' },
	{ label: 'Haemorrhagic Stroke — Basal Ganglia', side: 'Right' },
	{ label: 'Haemorrhagic Stroke — Thalamic', side: 'Left' },
	{ label: 'Traumatic Brain Injury — Diffuse Axonal', side: 'Bilateral' },
	{ label: 'Incomplete Spinal Cord Injury — C6 ASIA-C', side: 'Bilateral' },
	{ label: 'Post-Stroke Hemiparesis, chronic', side: 'Right' },
	{ label: 'Ischemic Stroke — Pontine', side: 'Left' }
];

export const MOBILITY = [
	'Wheelchair dependent',
	'Ambulatory with walker',
	'Ambulatory with cane',
	'Independently ambulatory',
	'Bed-bound, assisted transfers'
];

export const GAME_LABELS: Record<string, string> = {
	HAT: 'HAT — Hand Trainer Arcade',
	PongGame: 'PongGame',
	PONG: 'Pong',
	FruitBasket: 'Fruit Basket',
	FRUITCH: 'Fruit Catch',
	RNR: 'RNR — Reach & Retrieve',
	HatRick: 'HatRick Precision',
	TukTuk: 'TukTuk Drive',
	TUK: 'Tuk Tuk Drive'
};

/**
 * Movement/mechanism codes the devices report. Only codes with a known meaning are listed; anything else is shown
 * exactly as the device sent it.
 */
export const MECHANISM_LABELS: Record<string, string> = {
	WFE: 'Wrist flexion / extension',
	FPS: 'Forearm pronation / supination',
	WURD: 'Wrist ulnar / radial deviation',
	ML: 'Medio-lateral reach',
	AP: 'Antero-posterior reach',
	MLAP: 'Combined ML + AP reach'
};

/** What each device calls the thing it trains: PLUTO trains wrist mechanisms, MARS trains reach movements. */
export const movementTerm = (deviceTypeId: string | undefined) => (deviceTypeId === 'PLUTO' ? 'Mechanism' : 'Movement');

export const labelFor = (map: Record<string, string>, code: string) => map[code] ?? code;

export const DEVICE_STATUSES = [
	'Available',
	'In Use',
	'Issue Detected',
	'Awaiting Engineer',
	'Maintenance'
] as const;

export const ISSUE_SEVERITIES = ['Low', 'Medium', 'High', 'Critical'] as const;

export const ASSESSMENT_LABELS = ['Baseline', 'Day 7', 'Day 14', 'Day 21', 'Day 28', 'Follow-up', 'Discharge'];

export const REQUEST_PENDING = 'Pending Engineer Review';
export const REQUEST_CLEARED = 'Cleared — Ready to Assign';
