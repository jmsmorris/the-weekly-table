// Public settings for the Supabase project. The anon (public) key is designed
// to be visible in a public repo: the database functions in supabase/schema.sql
// only release a household's data to someone who knows that household's code.
// NEVER paste the "service_role" / secret key here.
window.WT_CONFIG = {
  supabaseUrl: "https://gitrtnnpmouqulgdejtd.supabase.co",
  supabaseAnonKey: "sb_publishable_P05ZCCSu-o17dbP6DC8spQ_NmXtFwQG",
  // URL slug of the deployed import-recipe edge function (the dashboard named it).
  importFunction: "rapid-action"
};
