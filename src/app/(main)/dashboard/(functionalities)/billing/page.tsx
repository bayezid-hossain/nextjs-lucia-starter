import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { ExclamationTriangleIcon } from "@/components/icons";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { env } from "@/env";
import { validateRequest } from "@/lib/actions/auth/validate-request";
import { APP_TITLE } from "@/lib/constants";
import * as React from "react";
import { BillingSkeleton } from "./_components/billing-skeleton";

export const metadata: Metadata = {
  metadataBase: new URL(env.NEXT_PUBLIC_APP_URL),
  title: "Billing",
  description: "Manage your billing and subscription",
};

export default async function BillingPage() {
  const { user } = await validateRequest();

  if (!user) {
    redirect("/login");
  }

  return (
    <div className="grid gap-8">
      <div>
        <h1 className="text-3xl font-bold md:text-4xl">Billing</h1>
        <p className="text-sm text-muted-foreground">Manage your billing and subscription</p>
      </div>
      <section>
        <Alert className="p-6 [&>svg]:left-6 [&>svg]:top-6 [&>svg~*]:pl-10">
          <ExclamationTriangleIcon className="h-6 w-6" />
          <AlertTitle>This is a demo app.</AlertTitle>
          <AlertDescription>
            {APP_TITLE} app is a demo app using a Stripe test environment. You can find a list of
            test card numbers on the{" "}
            <a
              href="https://stripe.com/docs/testing#cards"
              target="_blank"
              rel="noreferrer"
              className="font-medium underline underline-offset-4"
            >
              Stripe docs
            </a>
            .
          </AlertDescription>
        </Alert>
      </section>
    </div>
  );
}
