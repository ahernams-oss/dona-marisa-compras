import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Shield, ShieldOff, Search, Users, Crown, Store, Tag } from "lucide-react";
import { toast } from "sonner";

import {
  checkIsAdmin,
  listUsers,
  setUserRole,
  listPricesByMarket,
} from "@/lib/admin.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/admin")({
  component: AdminPage,
});

function AdminPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const checkFn = useServerFn(checkIsAdmin);
  const listFn = useServerFn(listUsers);
  const setRoleFn = useServerFn(setUserRole);
  const pricesFn = useServerFn(listPricesByMarket);

  const adminQuery = useQuery({
    queryKey: ["is-admin"],
    queryFn: () => checkFn({}),
  });

  const isAdmin = adminQuery.data?.isAdmin;

  useEffect(() => {
    if (adminQuery.isSuccess && !isAdmin) {
      toast.error("Acesso restrito a administradores");
      navigate({ to: "/lists" });
    }
  }, [adminQuery.isSuccess, isAdmin, navigate]);

  const usersQuery = useQuery({
    queryKey: ["admin-users"],
    queryFn: () => listFn({}),
    enabled: !!isAdmin,
  });

  const mutate = useMutation({
    mutationFn: (vars: { userId: string; role: "admin" | "user"; grant: boolean }) =>
      setRoleFn({ data: vars }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-users"] });
      toast.success("Permissão atualizada");
    },
    onError: (err: any) => toast.error(err?.message ?? "Erro ao atualizar"),
  });

  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const list = usersQuery.data ?? [];
    if (!search.trim()) return list;
    const q = search.toLowerCase();
    return list.filter(
      (u) =>
        u.email.toLowerCase().includes(q) ||
        (u.full_name ?? "").toLowerCase().includes(q),
    );
  }, [usersQuery.data, search]);

  const adminCount = (usersQuery.data ?? []).filter((u) => u.roles.includes("admin")).length;
  const total = usersQuery.data?.length ?? 0;

  if (adminQuery.isLoading || !isAdmin) {
    return (
      <div className="py-20 text-center text-muted-foreground">Verificando permissões…</div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight">Administração</h1>
          <p className="text-sm text-muted-foreground">
            Gerencie usuários e permissões do sistema.
          </p>
        </div>
        <Shield className="h-8 w-8 text-primary" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Usuários totais
            </CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{total}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Administradores
            </CardTitle>
            <Crown className="h-4 w-4 text-coral" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{adminCount}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle>Usuários</CardTitle>
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nome ou e-mail"
              className="pl-8"
            />
          </div>
        </CardHeader>
        <CardContent>
          {usersQuery.isLoading ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Carregando…</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Usuário</TableHead>
                  <TableHead>E-mail</TableHead>
                  <TableHead>Último acesso</TableHead>
                  <TableHead>Papel</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((u) => {
                  const isAdminUser = u.roles.includes("admin");
                  return (
                    <TableRow key={u.id}>
                      <TableCell>
                        <div className="font-medium">{u.full_name ?? "—"}</div>
                        {u.city && (
                          <div className="text-xs text-muted-foreground">{u.city}</div>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">{u.email}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {u.last_sign_in_at
                          ? new Date(u.last_sign_in_at).toLocaleDateString("pt-BR")
                          : "Nunca"}
                      </TableCell>
                      <TableCell>
                        {isAdminUser ? (
                          <Badge className="bg-coral text-coral-foreground hover:bg-coral/90">
                            Admin
                          </Badge>
                        ) : (
                          <Badge variant="secondary">Usuário</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {isAdminUser ? (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={mutate.isPending}
                            onClick={() =>
                              mutate.mutate({
                                userId: u.id,
                                role: "admin",
                                grant: false,
                              })
                            }
                          >
                            <ShieldOff className="h-3.5 w-3.5" /> Revogar admin
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            disabled={mutate.isPending}
                            onClick={() =>
                              mutate.mutate({
                                userId: u.id,
                                role: "admin",
                                grant: true,
                              })
                            }
                          >
                            <Shield className="h-3.5 w-3.5" /> Tornar admin
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
                {filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                      Nenhum usuário encontrado.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
