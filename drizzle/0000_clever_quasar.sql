CREATE TABLE `live_agencies` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`owner_email` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`owner_email`) REFERENCES `live_users`(`email`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `live_agencies_slug` ON `live_agencies` (`slug`);--> statement-breakpoint
CREATE TABLE `live_agency_members` (
	`id` text PRIMARY KEY NOT NULL,
	`agency_id` text NOT NULL,
	`user_email` text NOT NULL,
	`role` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`agency_id`) REFERENCES `live_agencies`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_email`) REFERENCES `live_users`(`email`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `live_agency_member_unique` ON `live_agency_members` (`agency_id`,`user_email`);--> statement-breakpoint
CREATE INDEX `live_agency_member_email` ON `live_agency_members` (`user_email`);--> statement-breakpoint
CREATE TABLE `live_client_members` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`user_email` text NOT NULL,
	`role` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `live_clients`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_email`) REFERENCES `live_users`(`email`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `live_client_member_unique` ON `live_client_members` (`client_id`,`user_email`);--> statement-breakpoint
CREATE TABLE `live_clients` (
	`id` text PRIMARY KEY NOT NULL,
	`agency_id` text NOT NULL,
	`name` text NOT NULL,
	`domain` text NOT NULL,
	`contact_email` text,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`agency_id`) REFERENCES `live_agencies`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `live_clients_agency` ON `live_clients` (`agency_id`);--> statement-breakpoint
CREATE TABLE `live_events` (
	`id` text PRIMARY KEY NOT NULL,
	`agency_id` text NOT NULL,
	`project_id` text,
	`event_type` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`actor_email` text NOT NULL,
	`client_visible` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`agency_id`) REFERENCES `live_agencies`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `live_projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `live_events_agency` ON `live_events` (`agency_id`);--> statement-breakpoint
CREATE INDEX `live_events_project` ON `live_events` (`project_id`);--> statement-breakpoint
CREATE TABLE `live_opportunities` (
	`id` text PRIMARY KEY NOT NULL,
	`agency_id` text NOT NULL,
	`project_id` text NOT NULL,
	`keyword` text NOT NULL,
	`current_rank` integer,
	`target_rank` integer DEFAULT 10 NOT NULL,
	`score` integer NOT NULL,
	`action_type` text NOT NULL,
	`reason` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`agency_id`) REFERENCES `live_agencies`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `live_projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `live_opportunities_project` ON `live_opportunities` (`project_id`);--> statement-breakpoint
CREATE INDEX `live_opportunities_agency` ON `live_opportunities` (`agency_id`);--> statement-breakpoint
CREATE TABLE `live_packages` (
	`id` text PRIMARY KEY NOT NULL,
	`agency_id` text NOT NULL,
	`project_id` text NOT NULL,
	`opportunity_id` text NOT NULL,
	`title` text NOT NULL,
	`implementation_path` text NOT NULL,
	`status` text DEFAULT 'agency_review' NOT NULL,
	`package_data` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`agency_id`) REFERENCES `live_agencies`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `live_projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`opportunity_id`) REFERENCES `live_opportunities`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `live_packages_agency` ON `live_packages` (`agency_id`);--> statement-breakpoint
CREATE INDEX `live_packages_project` ON `live_packages` (`project_id`);--> statement-breakpoint
CREATE TABLE `live_projects` (
	`id` text PRIMARY KEY NOT NULL,
	`agency_id` text NOT NULL,
	`client_id` text NOT NULL,
	`name` text NOT NULL,
	`domain` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`agency_id`) REFERENCES `live_agencies`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`client_id`) REFERENCES `live_clients`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `live_projects_agency` ON `live_projects` (`agency_id`);--> statement-breakpoint
CREATE INDEX `live_projects_client` ON `live_projects` (`client_id`);--> statement-breakpoint
CREATE TABLE `live_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`agency_id` text NOT NULL,
	`project_id` text NOT NULL,
	`opportunity_id` text,
	`title` text NOT NULL,
	`status` text DEFAULT 'ready' NOT NULL,
	`priority` text DEFAULT 'medium' NOT NULL,
	`assigned_email` text,
	`implementation_path` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`agency_id`) REFERENCES `live_agencies`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `live_projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`opportunity_id`) REFERENCES `live_opportunities`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `live_tasks_agency` ON `live_tasks` (`agency_id`);--> statement-breakpoint
CREATE INDEX `live_tasks_project` ON `live_tasks` (`project_id`);--> statement-breakpoint
CREATE TABLE `live_users` (
	`email` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`platform_role` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
