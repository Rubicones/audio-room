import type { Metadata } from "next";
import HomePage from "@/app/HomePage";
import { generateProjectRouteMetadata } from "@/lib/projectMetadata";

type ProjectPageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

export async function generateMetadata({
  params,
  searchParams,
}: ProjectPageProps): Promise<Metadata> {
  return generateProjectRouteMetadata({
    params: await params,
    searchParams: await searchParams,
    pathPrefix: "project",
  });
}

export default HomePage;
