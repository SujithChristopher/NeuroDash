// Icon/tone per device event type — shared by the device timeline and the fleet history page.
export const EVENT_ICON: Record<string, string> = {
	registered: 'box',
	assigned: 'link',
	maintenance: 'wrench',
	issue: 'alert',
	investigating: 'search',
	resolved: 'check',
	cleared: 'shield'
};

export const EVENT_TONE: Record<string, string> = {
	registered: 'info',
	assigned: 'accent',
	maintenance: 'warning',
	issue: 'critical',
	investigating: 'warning',
	resolved: 'info',
	cleared: 'good'
};

export const ISSUE_TYPES = [
	'Sensor reading intermittent or zero',
	'Motor / actuator fault',
	'Calibration drift',
	'Connectivity / sync failure',
	'Physical damage',
	'Firmware error',
	'Safety or strap mechanism fault'
];

export const MAINTENANCE_TYPES = [
	'Scheduled Calibration',
	'Firmware Update',
	'Sensor Replacement',
	'Inspection & Safety Check',
	'Cleaning & Sanitisation'
];
