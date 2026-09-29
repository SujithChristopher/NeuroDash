export const SCALES = {
	'FMA-UE': { name: 'Fugl-Meyer Upper Extremity', max: 66, mcid: 5 },
	BBS: { name: 'Berg Balance Scale', max: 56, mcid: 4 }
} as const;
export type ScaleId = keyof typeof SCALES;

export interface DeviceType {
	id: string;
	name: string;
	category: string;
	scale: ScaleId;
	outUnit: string;
	outLimit: number;
	units: number;
	mechanisms: string[];
	games: string[];
}

export const DEVICE_TYPES: DeviceType[] = [
	{
		id: 'PLUTO',
		name: 'Pluto',
		category: 'Wrist & Hand Robot',
		scale: 'FMA-UE',
		outUnit: 'Nm',
		outLimit: 1.2,
		units: 4,
		mechanisms: ['Wrist Flex/Ext', 'Pronation/Supination', 'Hand Open/Close'],
		games: ['HAT', 'FruitBasket', 'PongGame']
	},
	{
		id: 'MARS',
		name: 'Mars',
		category: 'Arm Support Robot',
		scale: 'FMA-UE',
		outUnit: 'Nm',
		outLimit: 8.0,
		units: 3,
		mechanisms: ['Shoulder Flexion', 'Elbow Extension', 'Reach & Grasp'],
		games: ['PongGame', 'TukTuk']
	},
	{
		id: 'ORION',
		name: 'Orion',
		category: 'Grip & Pinch Trainer',
		scale: 'FMA-UE',
		outUnit: 'N',
		outLimit: 60,
		units: 2,
		mechanisms: ['Cylindrical Grip', 'Pinch Grip', 'Finger Extension'],
		games: ['RNR', 'HatRick']
	},
	{
		id: 'VEGA',
		name: 'Vega',
		category: 'Balance & Lower-Limb Trainer',
		scale: 'BBS',
		outUnit: 'N',
		outLimit: 400,
		units: 2,
		mechanisms: ['Weight Shift', 'Ankle Dorsiflexion', 'Sit-to-Stand'],
		games: ['TukTuk', 'PongGame']
	},
	{
		id: 'COSMOS',
		name: 'Cosmos',
		category: 'Fine Motor Game Station',
		scale: 'FMA-UE',
		outUnit: 'N',
		outLimit: 25,
		units: 2,
		mechanisms: ['Precision Reach', 'Bimanual Coordination'],
		games: ['FruitBasket', 'HatRick']
	},
	{
		id: 'ATLAS',
		name: 'Atlas',
		category: 'Shoulder & Scapular Robot',
		scale: 'FMA-UE',
		outUnit: 'Nm',
		outLimit: 12,
		units: 1,
		mechanisms: ['Shoulder Abduction', 'Scapular Stabilisation'],
		games: ['HAT', 'RNR']
	}
];

export const GAME_LABELS: Record<string, string> = {
	HAT: 'Hand Trainer Arcade',
	PongGame: 'Pong',
	FruitBasket: 'Fruit Basket',
	RNR: 'Reach & Retrieve',
	TukTuk: 'TukTuk Drive',
	HatRick: 'HatRick Precision'
};

export const typeOf = (id: string) => DEVICE_TYPES.find((t) => t.id === id);

export const ROOMS = ['Therapy Bay 1', 'Therapy Bay 2', 'Therapy Bay 3', 'Gait & Balance Lab'];
