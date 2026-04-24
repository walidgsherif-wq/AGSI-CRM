import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

export default function LoginPage() {
  return (
    <Card>
      <CardHeader>
        <Badge variant="amber" className="w-fit">M1 — placeholder</Badge>
        <CardTitle>Sign in</CardTitle>
        <CardDescription>
          The magic-link login flow arrives in milestone 3. For now, the app
          boots straight to the dashboard with a dev-only role switcher in
          the sidebar footer.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-agsi-darkGray">
          Head to <span className="font-mono text-agsi-navy">/dashboard</span> to preview the shell.
        </p>
      </CardContent>
    </Card>
  );
}
