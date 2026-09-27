import Link from "next/link";

export default function ProjectNotFound() {
  return (
    <div className="grid h-full place-items-center">
      <div className="text-center">
        <h1 className="mb-2 text-lg font-semibold">Project not found</h1>
        <p className="mb-4 text-muted-foreground">It may have been deleted, or the link is wrong.</p>
        <Link href="/" className="text-primary underline-offset-4 hover:underline">
          Open your latest project
        </Link>
      </div>
    </div>
  );
}
