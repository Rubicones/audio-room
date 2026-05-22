import type { Metadata } from "next";
import HomePage from "@/app/HomePage";
import { generateProjectRouteMetadata } from "@/lib/projectMetadata";

type LegacyProjectPageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

export async function generateMetadata({
  params,
  searchParams,
}: LegacyProjectPageProps): Promise<Metadata> {
  return generateProjectRouteMetadata({
    params: await params,
    searchParams: await searchParams,
    pathPrefix: "p",
  });
}

export default HomePage;
