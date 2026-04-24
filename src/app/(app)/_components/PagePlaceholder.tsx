import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

export function PagePlaceholder({
  title,
  milestone,
  description,
  children,
}: {
  title: string;
  milestone: string;
  description: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-agsi-navy">{title}</h1>
          <p className="mt-1 text-sm text-agsi-darkGray">{description}</p>
        </div>
        <Badge variant="amber">{milestone}</Badge>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Not yet built</CardTitle>
          <CardDescription>
            This route is scaffolded in milestone 1 so the sidebar navigation works. The
            full page lands in the milestone shown on the right.
          </CardDescription>
        </CardHeader>
        {children ? <CardContent>{children}</CardContent> : null}
      </Card>
    </div>
  );
}
