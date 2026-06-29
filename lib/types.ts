// Shared types for the agent + dashboard.

export type DealStage =
  | 'lead' | 'qualified' | 'proposal' | 'negotiation' | 'won' | 'lost';

export type Sentiment = 'positive' | 'neutral' | 'negative';

export type Intent =
  | 'log_activity'      // "just spoke to Sarah at Acme..."
  | 'query'            // "who haven't I touched in two weeks?"
  | 'complete_followup'// "done with the Sarah follow-up"
  | 'help'
  | 'unknown';

export interface AppUser {
  id: string;
  team_id: string;
  phone: string;
  name: string | null;
  role: string;
}

// What the extractor returns for a logging message.
export interface ExtractedActivity {
  contact_name: string | null;
  company_name: string | null;
  summary: string;                 // cleaned note body
  sentiment: Sentiment | null;
  deal_title: string | null;
  deal_value: number | null;
  deal_currency: string | null;    // ISO 4217, e.g. GBP
  stage: DealStage | null;         // new stage if the rep signalled movement
  follow_up_at: string | null;     // ISO timestamp, resolved from "next Tuesday"
  follow_up_note: string | null;
}

export interface ExtractionResult {
  intent: Intent;
  activity?: ExtractedActivity;
  query_kind?: 'stale_contacts' | 'open_followups' | 'pipeline_summary' | 'other';
  followup_target?: string | null; // contact/company name for complete_followup
}

// The payload we park in pending_writes awaiting "yes".
export interface PendingPayload {
  kind: 'log_activity';
  resolved: {
    contact_id: string | null;
    contact_name: string;
    company_id: string | null;
    company_name: string | null;
    deal_id: string | null;
    create_contact: boolean;
    create_company: boolean;
    create_deal: boolean;
    contact_fuzzy: boolean;   // matched by similarity, not exact — flag in confirmation
    company_fuzzy: boolean;
  };
  extracted: ExtractedActivity;
}
