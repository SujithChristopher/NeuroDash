// Per-role navigation (spec §8.2) — labels and grouping are deliberate, match each role's mental model.
export type Role = 'THERAPIST' | 'CONSULTANT' | 'ENGINEER' | 'ADMIN';

export interface NavItem {
	to: string;
	label: string;
	icon: string;
}
export interface NavSection {
	section: string | null;
	items: NavItem[];
}

export const NAV_BY_ROLE: Record<Role, NavSection[]> = {
	THERAPIST: [
		{
			section: null,
			items: [
				{ to: '/', label: 'Overview', icon: 'home' },
				{ to: '/patients', label: 'My Patients', icon: 'users' },
				{ to: '/assessments', label: 'Assessments', icon: 'clipboard' },
				{ to: '/plans', label: 'Therapy Plans', icon: 'target' },
				{ to: '/sessions', label: 'Sessions', icon: 'activity' },
				{ to: '/devices', label: 'Devices', icon: 'device' },
				{ to: '/device-requests', label: 'Device Requests', icon: 'box' }
			]
		},
		{
			section: 'Insights',
			items: [
				{ to: '/analytics', label: 'Analytics', icon: 'bar' },
				{ to: '/reports', label: 'Reports', icon: 'report' },
				{ to: '/ai', label: 'AI Assistant', icon: 'chat' }
			]
		}
	],
	CONSULTANT: [
		{
			section: null,
			items: [
				{ to: '/', label: 'Overview', icon: 'home' },
				{ to: '/patients', label: 'Patients', icon: 'users' },
				{ to: '/plans', label: 'Therapy Plans', icon: 'target' },
				{ to: '/assessments', label: 'Assessments', icon: 'clipboard' },
				{ to: '/sessions', label: 'Sessions', icon: 'activity' }
			]
		},
		{
			section: 'Insights',
			items: [
				{ to: '/analytics', label: 'Analytics', icon: 'bar' },
				{ to: '/reports', label: 'Reports', icon: 'report' },
				{ to: '/ai', label: 'AI Assistant', icon: 'chat' }
			]
		}
	],
	ENGINEER: [
		{
			section: null,
			items: [
				{ to: '/analytics', label: 'Device Overview', icon: 'gauge' },
				{ to: '/devices', label: 'Devices', icon: 'device' },
				{ to: '/device-issues', label: 'Issues', icon: 'alert' },
				{ to: '/maintenance', label: 'Maintenance', icon: 'wrench' },
				{ to: '/device-usage', label: 'Usage', icon: 'bar' }
			]
		},
		{
			section: 'Records',
			items: [
				{ to: '/device-history', label: 'Device History', icon: 'history' },
				{ to: '/data-sync', label: 'Data Sync', icon: 'link' },
				{ to: '/notifications', label: 'Notifications', icon: 'bell' }
			]
		}
	],
	ADMIN: [
		{
			section: null,
			items: [
				{ to: '/analytics', label: 'Overview', icon: 'home' },
				{ to: '/patients', label: 'Patients', icon: 'users' },
				{ to: '/users', label: 'Users', icon: 'shield' },
				{ to: '/locations', label: 'Locations', icon: 'flag' },
				{ to: '/devices', label: 'Devices', icon: 'device' },
				{ to: '/sessions', label: 'Sessions', icon: 'activity' },
				{ to: '/assessments', label: 'Assessments', icon: 'clipboard' },
				{ to: '/plans', label: 'Plans', icon: 'target' }
			]
		},
		{
			section: 'Governance',
			items: [
				{ to: '/reports', label: 'Reports', icon: 'report' },
				{ to: '/audit-log', label: 'Audit Log', icon: 'history' },
				{ to: '/data-sync', label: 'Data Sync', icon: 'link' },
				{ to: '/ai', label: 'AI Assistant', icon: 'chat' }
			]
		}
	]
};

/** Breadcrumb titles by first path segment. */
export const PAGE_TITLES: Record<string, string> = {
	'': 'Overview',
	analytics: 'Analytics',
	patients: 'Patients',
	assessments: 'Assessments',
	plans: 'Therapy Plans',
	sessions: 'Sessions',
	devices: 'Devices',
	'device-requests': 'Device Requests',
	'device-issues': 'Device Issues',
	maintenance: 'Maintenance',
	'device-usage': 'Device Usage',
	'device-history': 'Device History',
	'data-sync': 'Data Sync',
	users: 'Users',
	locations: 'Locations',
	notifications: 'Notifications',
	profile: 'Profile',
	reports: 'Reports',
	ai: 'AI Assistant',
	'audit-log': 'Audit Log'
};

/** Pages where Admin sees the READ ONLY banner. */
export const READ_ONLY_PAGES = ['patients', 'assessments', 'plans', 'sessions', 'devices', 'analytics'];
