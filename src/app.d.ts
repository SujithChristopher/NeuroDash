declare global {
	namespace App {
		interface Locals {
			user: {
				id: string;
				displayCode: string;
				name: string;
				role: 'THERAPIST' | 'CONSULTANT' | 'ENGINEER' | 'ADMIN';
				title: string | null;
				email: string;
				initials: string | null;
				locationId: string | null;
				location: { id: string; name: string } | null;
			} | null;
		}
	}
}

export {};
