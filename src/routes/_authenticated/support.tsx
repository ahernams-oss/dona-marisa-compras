import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { LifeBuoy, Send, Clock, CheckCircle2, Loader2 } from "lucide-react";
import { toast } from "sonner";

import {
  sendSupportMessage,
  listMySupportMessages,
} from "@/lib/support.functions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_authenticated/support")({
  component: SupportPage,
});

const MAX = 500;

const statusLabels: Record<string, { label: string; className: string; icon: any }> = {
  open: { label: "Aberta", className: "bg-amber-100 text-amber-900", icon: Clock },
  in_progress: { label: "Em análise", className: "bg-blue-100 text-blue-900", icon: Loader2 },
  resolved: { label: "Resolvida", className: "bg-emerald-100 text-emerald-900", icon: CheckCircle2 },
};

function SupportPage() {
  const qc = useQueryClient();
  const sendFn = useServerFn(sendSupportMessage);
  const listFn = useServerFn(listMySupportMessages);

  const messagesQuery = useQuery({
    queryKey: ["my-support-messages"],
    queryFn: () => listFn({}),
  });

  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");

  const sendMutation = useMutation({
    mutationFn: () => sendFn({ data: { subject, body } }),
    onSuccess: () => {
      toast.success("Mensagem enviada. Nossa equipe responderá em breve.");
      setSubject("");
      setBody("");
      qc.invalidateQueries({ queryKey: ["my-support-messages"] });
    },
    onError: (err: any) => toast.error(err?.message ?? "Erro ao enviar"),
  });

  const remaining = MAX - body.length;
  const canSend = subject.trim().length > 0 && body.trim().length > 0 && body.length <= MAX;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight">Suporte</h1>
          <p className="text-sm text-muted-foreground">
            Envie dúvidas, sugestões ou solicitações para moderadores e administradores.
          </p>
        </div>
        <LifeBuoy className="h-8 w-8 text-primary" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Nova solicitação</CardTitle>
          <CardDescription>Máximo de 500 caracteres na mensagem.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Assunto</label>
            <Input
              value={subject}
              onChange={(e) => setSubject(e.target.value.slice(0, 120))}
              placeholder="Ex: Solicitar nova marca, dúvida sobre lista…"
              maxLength={120}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Mensagem</label>
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value.slice(0, MAX))}
              placeholder="Descreva sua solicitação"
              rows={5}
              maxLength={MAX}
            />
            <div
              className={`text-xs ${remaining < 50 ? "text-coral" : "text-muted-foreground"}`}
            >
              {remaining} caracteres restantes
            </div>
          </div>
          <div className="flex justify-end">
            <Button
              onClick={() => sendMutation.mutate()}
              disabled={!canSend || sendMutation.isPending}
            >
              <Send className="mr-2 h-4 w-4" />
              {sendMutation.isPending ? "Enviando…" : "Enviar"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Minhas solicitações</CardTitle>
          <CardDescription>Histórico e respostas da equipe.</CardDescription>
        </CardHeader>
        <CardContent>
          {messagesQuery.isLoading ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Carregando…</p>
          ) : (messagesQuery.data ?? []).length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Você ainda não enviou nenhuma solicitação.
            </p>
          ) : (
            <ul className="space-y-3">
              {(messagesQuery.data ?? []).map((m: any) => {
                const s = statusLabels[m.status] ?? statusLabels.open;
                const Icon = s.icon;
                return (
                  <li key={m.id} className="rounded-lg border p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-medium">{m.subject}</div>
                        <div className="text-xs text-muted-foreground">
                          {new Date(m.created_at).toLocaleString("pt-BR")}
                        </div>
                      </div>
                      <Badge className={s.className}>
                        <Icon className="mr-1 h-3 w-3" /> {s.label}
                      </Badge>
                    </div>
                    <p className="mt-2 whitespace-pre-wrap text-sm">{m.body}</p>
                    {m.staff_reply && (
                      <div className="mt-3 rounded-md bg-accent p-3">
                        <div className="mb-1 text-xs font-semibold text-muted-foreground">
                          Resposta da equipe
                          {m.replied_at
                            ? ` · ${new Date(m.replied_at).toLocaleString("pt-BR")}`
                            : ""}
                        </div>
                        <p className="whitespace-pre-wrap text-sm">{m.staff_reply}</p>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
