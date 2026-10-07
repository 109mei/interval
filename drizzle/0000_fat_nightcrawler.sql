CREATE TABLE `commands` (
	`room_id` text NOT NULL,
	`seat` text NOT NULL,
	`command_id` text NOT NULL,
	`payload_hash` text NOT NULL,
	`version` integer NOT NULL,
	PRIMARY KEY(`room_id`, `seat`, `command_id`),
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `rates` (
	`key` text PRIMARY KEY NOT NULL,
	`count` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_rates_expires` ON `rates` (`expires_at`);--> statement-breakpoint
CREATE TABLE `rooms` (
	`id` text PRIMARY KEY NOT NULL,
	`invite_hash` text NOT NULL,
	`host_hash` text NOT NULL,
	`guest_hash` text,
	`create_key` text NOT NULL,
	`state` text NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	`white_ready` integer DEFAULT 0 NOT NULL,
	`black_ready` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'waiting' NOT NULL,
	`expires_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`last_nonce` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rooms_create_key_unique` ON `rooms` (`create_key`);--> statement-breakpoint
CREATE INDEX `idx_rooms_expires` ON `rooms` (`expires_at`);--> statement-breakpoint
CREATE INDEX `idx_rooms_host` ON `rooms` (`host_hash`);