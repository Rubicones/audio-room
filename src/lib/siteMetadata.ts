import type { Metadata } from "next";

export const SITE_NAME = "Foam";

export const DEFAULT_SITE_TITLE = "Foam | Interactive Sound Acoustics Simulator";

export const DEFAULT_SITE_DESCRIPTION =
  "An interactive visual and audio simulator designed for educators, students, and aspiring sound engineers. Explore spatial audio, room acoustics, and wave physics in real-time.";

export const OG_IMAGE_PATH = "/favicon.svg";
export const OG_IMAGE_WIDTH = 512;
export const OG_IMAGE_HEIGHT = 512;

export function getSiteUrl(): string {
  const raw =
    process.env.NEXT_PUBLIC_SITE_URL ??
    process.env.NEXT_PUBLIC_VERCEL_URL ??
    "http://localhost:3000";

  const withProtocol = raw.startsWith("http") ? raw : `https://${raw}`;
  return withProtocol.replace(/\/$/, "");
}

type SocialImageInput = {
  alt: string;
  path?: string;
};

export function buildSocialImages({ alt }: SocialImageInput) {
  return [
    {
      url: OG_IMAGE_PATH,
      width: OG_IMAGE_WIDTH,
      height: OG_IMAGE_HEIGHT,
      alt,
    },
  ];
}

type PageMetadataInput = {
  title: string;
  description: string;
  path?: string;
  imageAlt?: string;
};

export function buildPageMetadata({
  title,
  description,
  path = "/",
  imageAlt,
}: PageMetadataInput): Metadata {
  const images = buildSocialImages({
    alt: imageAlt ?? `${title} — ${SITE_NAME}`,
  });
  const canonicalPath = path.startsWith("/") ? path : `/${path}`;
  const url = `${getSiteUrl()}${canonicalPath}`;

  return {
    title,
    description,
    alternates: {
      canonical: url,
    },
    openGraph: {
      type: "website",
      siteName: SITE_NAME,
      locale: "en_US",
      title,
      description,
      url,
      images,
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [OG_IMAGE_PATH],
    },
  };
}

export const workspacePageMetadata = buildPageMetadata({
  title: "Interactive Audio Mixer & Sandbox",
  description:
    "Design your custom acoustic environment. Adjust room dimensions, toggle wall materials, place obstacles, and position sound sources in a real-time web audio simulation.",
  path: "/",
  imageAlt: "Foam interactive audio mixer and acoustic sandbox",
});

export const sharedProjectMetadata = buildPageMetadata({
  title: "Shared Acoustic Environment",
  description:
    "Listen to this custom 3D audio space simulated via Foam. Explore the spatial breakdown of tracks inside this interactive acoustic room.",
  imageAlt: "Shared Foam acoustic environment preview",
});

export const quizProjectMetadata = buildPageMetadata({
  title: "Acoustics Audio Quiz — Test Your Ears",
  description:
    "Someone challenged you to a spatial audio quiz on Foam! Listen closely to the room reflections, guess where the tracks are hidden, and test your 3D audio perception.",
  imageAlt: "Foam spatial audio quiz challenge preview",
});

export function buildProjectPageMetadata(input: {
  projectId: string;
  projectTitle?: string | null;
  isQuizMode: boolean;
  pathPrefix?: "project" | "p";
}): Metadata {
  const pathPrefix = input.pathPrefix ?? "project";
  const path = `/${pathPrefix}/${input.projectId}${
    input.isQuizMode ? "?quizMode=true" : ""
  }`;

  if (input.isQuizMode) {
    return {
      ...quizProjectMetadata,
      alternates: {
        canonical: `${getSiteUrl()}${path}`,
      },
      openGraph: {
        ...quizProjectMetadata.openGraph,
        url: `${getSiteUrl()}${path}`,
      },
    };
  }

  if (input.projectTitle?.trim()) {
    const title = input.projectTitle.trim();
    return buildPageMetadata({
      title,
      description: `Explore "${title}" — a custom 3D audio space simulated in Foam. Listen to spatial tracks and study how room acoustics shape the mix in real time.`,
      path,
      imageAlt: `${title} acoustic project on Foam`,
    });
  }

  return {
    ...sharedProjectMetadata,
    alternates: {
      canonical: `${getSiteUrl()}${path}`,
    },
    openGraph: {
      ...sharedProjectMetadata.openGraph,
      url: `${getSiteUrl()}${path}`,
    },
  };
}
