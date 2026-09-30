export interface NotificationItem {
	id: string;
	title: string;
	description: string;
	tone: string;
	icon: string | null;
	isRead: boolean;
	createdAt: string | Date;
	link: { page: string } | null;
}
