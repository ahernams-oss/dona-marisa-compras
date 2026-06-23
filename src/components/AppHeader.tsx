import { Link, useNavigate } from "@tanstack/react-router";
import { ShoppingBasket, LogOut, Camera, Store, ListChecks } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";

export function AppHeader() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();

  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
        <Link to="/" className="flex items-center gap-2">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary text-primary-foreground shadow-soft">
            <ShoppingBasket className="h-5 w-5" />
          </span>
          <span className="font-display text-lg font-bold tracking-tight">Dona Maria</span>
        </Link>

        {user ? (
          <nav className="flex items-center gap-1">
            <Link
              to="/lists"
              className="hidden items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground sm:flex"
              activeProps={{ className: "bg-accent text-foreground" }}
            >
              <ListChecks className="h-4 w-4" /> Minhas listas
            </Link>
            <Link
              to="/markets"
              className="hidden items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground sm:flex"
              activeProps={{ className: "bg-accent text-foreground" }}
            >
              <Store className="h-4 w-4" /> Mercados
            </Link>
            <Link
              to="/report"
              className="ml-1 inline-flex items-center gap-1.5 rounded-full bg-coral px-3 py-1.5 text-sm font-semibold text-coral-foreground shadow-soft transition hover:opacity-90"
            >
              <Camera className="h-4 w-4" /> Reportar preço
            </Link>
            <Button
              variant="ghost"
              size="icon"
              className="ml-1 rounded-full"
              onClick={async () => {
                await signOut();
                navigate({ to: "/" });
              }}
              aria-label="Sair"
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </nav>
        ) : (
          <div className="flex items-center gap-2">
            <Link
              to="/auth"
              className="rounded-full px-4 py-1.5 text-sm font-semibold text-foreground hover:bg-accent"
            >
              Entrar
            </Link>
          </div>
        )}
      </div>
    </header>
  );
}
