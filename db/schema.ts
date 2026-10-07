import {
  sqliteTable,
  text,
  integer,
  index,
  primaryKey,
} from "drizzle-orm/sqlite-core";
export const rooms = sqliteTable(
  "rooms",
  {
    id: text("id").primaryKey(),
    inviteHash: text("invite_hash").notNull(),
    hostHash: text("host_hash").notNull(),
    guestHash: text("guest_hash"),
    createKey: text("create_key").notNull().unique(),
    state: text("state").notNull(),
    version: integer("version").notNull().default(0),
    whiteReady: integer("white_ready").notNull().default(0),
    blackReady: integer("black_ready").notNull().default(0),
    status: text("status").notNull().default("waiting"),
    expiresAt: integer("expires_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    lastNonce: text("last_nonce"),
  },
  (t) => [
    index("idx_rooms_expires").on(t.expiresAt),
    index("idx_rooms_host").on(t.hostHash),
  ],
);
export const commands = sqliteTable(
  "commands",
  {
    roomId: text("room_id")
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),
    seat: text("seat").notNull(),
    commandId: text("command_id").notNull(),
    payloadHash: text("payload_hash").notNull(),
    version: integer("version").notNull(),
  },
  (t) => [primaryKey({ columns: [t.roomId, t.seat, t.commandId] })],
);
export const rates = sqliteTable(
  "rates",
  {
    key: text("key").primaryKey(),
    count: integer("count").notNull(),
    expiresAt: integer("expires_at").notNull(),
  },
  (t) => [index("idx_rates_expires").on(t.expiresAt)],
);
