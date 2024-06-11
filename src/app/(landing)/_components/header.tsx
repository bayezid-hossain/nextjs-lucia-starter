import Link from "next/link";
import { RocketIcon } from "@/components/icons";
import { APP_TITLE } from "@/lib/constants";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { HamburgerMenuIcon, MagicWandIcon } from "@radix-ui/react-icons";
import { SubmitButton } from "@/components/submit-button";
import { logout } from "@/lib/auth/actions";
import { validateRequest } from "@/lib/auth/validate-request";
import { UserDropdown } from "@/app/(main)/_components/user-dropdown";

const routes = [
  { name: "Home", href: "/" },
  { name: "Dashboard", href: "/dashboard" },
  { name: "Login", href: "/login" },
  { name: "Sign up", href: "/signup" },
] as const;

export const Header = async () => {
  const { user } = await validateRequest();
  console.log(user);
  return (
    <header className="sticky top-0 z-10 mb-4 w-full border-b bg-background/80 p-0">
      <div className="container my-2 flex items-center gap-2 p-0">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              className="ml-2 focus:outline-none focus:ring-1 sm:hidden"
              size="icon"
              variant="outline"
            >
              <HamburgerMenuIcon className="h-5 w-5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="mt-1 flex flex-col sm:hidden">
            <div className="flex flex-col gap-y-2 py-1">
              {routes.map(({ name, href }) => {
                if (name === "Dashboard" && user) {
                  return (
                    <DropdownMenuItem key={name} asChild>
                      <Button variant={"link"}>
                        <Link href={href}>{name}</Link>
                      </Button>
                    </DropdownMenuItem>
                  );
                } else if (name !== "Dashboard") {
                  if ((name === "Login" && !user) || (name === "Sign up" && !user))
                    return (
                      <DropdownMenuItem key={name} asChild>
                        <Button variant={"link"}>
                          <Link href={href}>{name}</Link>
                        </Button>
                      </DropdownMenuItem>
                    );
                }
              })}
            </div>{" "}
            {user && (
              <DropdownMenuItem key={"logout"} asChild>
                <form action={logout} className=" ">
                  <SubmitButton variant="link">Logout</SubmitButton>
                </form>
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        <Link className="flex items-center justify-center pl-2 text-lg font-medium" href="/">
          <MagicWandIcon className="mr-2 h-5 w-5" /> <p className=" block">{APP_TITLE}</p>{" "}
        </Link>
        {user && (
          <Button asChild variant={"link"}>
            <Link href="/dashboard" className="hidden text-base sm:flex sm:text-lg">
              Dashboard
            </Link>
          </Button>
        )}
        {!user && (
          <div className="ml-auto hidden gap-x-4 sm:flex">
            <Button asChild variant={"outlineLink"}>
              <Link href="/login">Login</Link>
            </Button>
            <Button asChild variant={"outlineLink"} className="mr-2">
              <Link href="/signup">Sign Up</Link>
            </Button>
          </div>
        )}
        {user && <UserDropdown firstName={user.firstName} className="ml-auto mr-2" />}
      </div>
    </header>
  );
};
