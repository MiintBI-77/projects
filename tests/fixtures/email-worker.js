export { default, Conversation } from "../../worker/index";
import { Portfolio as Base } from "../../worker/index";
// Stands in for Cloudflare's send_email binding. Each attempt is recorded in
// the object's own storage, so the record survives a restart.
export class Portfolio extends Base {
  constructor(ctx, env) {
    const sql = ctx.storage.sql;
    sql.exec(
      "CREATE TABLE IF NOT EXISTS fake_email(seq INTEGER PRIMARY KEY AUTOINCREMENT,message TEXT NOT NULL)",
    );
    sql.exec(
      "CREATE TABLE IF NOT EXISTS fake_email_state(id INTEGER PRIMARY KEY,fail INTEGER NOT NULL)",
    );
    super(ctx, {
      ...env,
      EMAIL: {
        async send(message) {
          const { seq } = sql
            .exec(
              "INSERT INTO fake_email(message) VALUES(?) RETURNING seq",
              JSON.stringify(message),
            )
            .one();
          await new Promise((resolve) => setTimeout(resolve, 20));
          if (sql.exec("SELECT fail FROM fake_email_state WHERE id=1").toArray()[0]?.fail)
            throw Error("E_DELIVERY_FAILED: provider detail must not leak");
          return { messageId: `message-${seq}` };
        },
      },
    });
  }
  sentEmails() {
    return this.ctx.storage.sql
      .exec("SELECT message FROM fake_email ORDER BY seq")
      .toArray()
      .map((row) => JSON.parse(row.message));
  }
  failEmail(enabled) {
    this.ctx.storage.sql.exec(
      "INSERT INTO fake_email_state VALUES(1,?) ON CONFLICT(id) DO UPDATE SET fail=excluded.fail",
      enabled ? 1 : 0,
    );
  }
  // Leaves a day's send in a chosen state, such as one cut off by a restart.
  setEmailState(day, state) {
    this.ctx.storage.sql.exec("UPDATE review_emails SET state=? WHERE day=?", state, day);
  }
}
