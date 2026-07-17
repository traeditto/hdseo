// GitHub App authorization + installation callback.
// GitHub redirects here (redirect_uri = APP_URL + /api/github/callback), which must
// exactly match the callback URL registered in the GitHub App.
// The handling logic is shared with the connect route to avoid duplication.
export { GET } from "@/app/api/github/connect/route";
