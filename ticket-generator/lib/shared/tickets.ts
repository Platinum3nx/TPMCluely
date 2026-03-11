export type TicketType = "Bug" | "Feature" | "Task";

export interface Ticket {
  title: string;
  description: string;
  acceptance_criteria: string[];
  type: TicketType;
  idempotency_key: string;
}
