import Database from "better-sqlite3";
import { schema } from "./schema";

const dbPath = process.env.DATABASE_PATH || "./data/bytedance-mia.sqlite";

export const db = new Database(dbPath);
db.exec(schema);
