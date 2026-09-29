export type Role = 'therapist' | 'consultant' | 'engineer' | 'admin';

export interface User {
	id: string;
	role: Role;
	name: string;
	title: string;
	initials: string;
	owns?: string[];
	login: string;
	email: string;
	status: 'Active';
}

const RAW_USERS: Omit<User, 'login' | 'email' | 'status'>[] = [
	{ id: 'U-T1', role: 'therapist', name: 'Priya Nair', title: 'Senior Occupational Therapist', initials: 'PN' },
	{ id: 'U-T2', role: 'therapist', name: 'Rohan Mehta', title: 'Physiotherapist', initials: 'RM' },
	{ id: 'U-T3', role: 'therapist', name: 'Ananya Kapoor', title: 'Occupational Therapist', initials: 'AK' },
	{ id: 'U-T4', role: 'therapist', name: 'Farah Sheikh', title: 'Physiotherapist', initials: 'FS' },
	{
		id: 'U-C1',
		role: 'consultant',
		name: 'Vikram Suresh',
		title: 'Neuro-rehabilitation Consultant',
		initials: 'VS'
	},
	{ id: 'U-C2', role: 'consultant', name: 'Leela Menon', title: 'Consultant, Stroke Recovery', initials: 'LM' },
	{
		id: 'U-E1',
		role: 'engineer',
		name: 'Arjun Rao',
		title: 'Device engineer · Pluto, Mars',
		initials: 'AR',
		owns: ['PLUTO', 'MARS']
	},
	{
		id: 'U-E2',
		role: 'engineer',
		name: "Kevin D'Souza",
		title: 'Device engineer · Orion, Vega',
		initials: 'KD',
		owns: ['ORION', 'VEGA']
	},
	{
		id: 'U-E3',
		role: 'engineer',
		name: 'Meera Iyer',
		title: 'Device engineer · Cosmos, Atlas',
		initials: 'MI',
		owns: ['COSMOS', 'ATLAS']
	},
	{ id: 'U-A1', role: 'admin', name: 'Sam Thomas', title: 'System administrator', initials: 'ST' }
];

export const USERS: User[] = RAW_USERS.map((u) => {
	const login = u.name
		.toLowerCase()
		.replace(/[^a-z ]/g, '')
		.replace(' ', '.');
	return { ...u, login, email: login + '@neurorehab.org', status: 'Active' as const };
});

export const DEMO_PASSWORD = 'neuro@123';

export const userOf = (id: string) => USERS.find((u) => u.id === id);
export const usersByRole = (r: Role) => USERS.filter((u) => u.role === r);
export const ownerOfType = (typeId: string) => USERS.find((u) => u.owns && u.owns.includes(typeId));

export const ROLE_LABEL: Record<Role, string> = {
	therapist: 'Therapist',
	consultant: 'Consultant',
	engineer: 'Device engineer',
	admin: 'Administrator'
};
export const DENSITY: Record<Role, 'low' | 'medium' | 'high'> = {
	therapist: 'low',
	consultant: 'medium',
	engineer: 'high',
	admin: 'medium'
};
export const HOME: Record<Role, string> = { therapist: 'today', consultant: 'review', engineer: 'fleet', admin: 'overview' };

export type NavEntry = [page: string, label: string, icon: string] | `#${string}`;
export const NAV: Record<Role, NavEntry[]> = {
	therapist: [
		['today', 'Today', 'today'],
		['patients', 'My patients', 'users'],
		['equipment', 'Equipment', 'robot']
	],
	consultant: [
		['review', 'Clinical review', 'review'],
		['outcomes', 'Outcomes', 'trend']
	],
	engineer: [
		['fleet', 'Fleet', 'grid'],
		['service', 'Service', 'wrench'],
		['requests', 'Requests', 'inbox']
	],
	admin: [
		['overview', 'Overview', 'home'],
		'#Clinical',
		['review', 'Patients', 'users'],
		['outcomes', 'Outcomes', 'trend'],
		'#Devices',
		['fleet', 'Fleet', 'grid'],
		['service', 'Service', 'wrench'],
		['requests', 'Requests', 'inbox'],
		'#Organisation',
		['members', 'Members', 'user'],
		['audit', 'Audit log', 'shield']
	]
};

export const DETAIL: Record<string, Role[]> = {
	patient: ['therapist', 'consultant', 'admin'],
	device: ['engineer', 'admin']
};
