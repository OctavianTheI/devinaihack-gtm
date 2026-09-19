import { redirect } from "next/navigation";

// The app has two tabs, /monitor and /train. The manager view is the demo's
// starting point (PLAN.md §10), so the root sends people there.
export default function Home() {
  redirect("/monitor");
}
