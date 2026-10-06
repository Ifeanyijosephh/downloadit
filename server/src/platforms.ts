/** The ten supported platforms and the hostnames we accept for each (§9.5). */

export interface Platform {
  name: string;
  label: string;
  icon: string;
  hosts: string[];
}

export const PLATFORMS: Platform[] = [
  { name: 'youtube', label: 'YouTube', icon: '/assets/icons/3d/youtube.png', hosts: ['youtube.com', 'youtu.be', 'youtube-nocookie.com'] },
  { name: 'instagram', label: 'Instagram', icon: '/assets/icons/3d/instagram.png', hosts: ['instagram.com', 'instagr.am'] },
  { name: 'tiktok', label: 'TikTok', icon: '/assets/icons/3d/tiktok.png', hosts: ['tiktok.com'] },
  { name: 'x', label: 'X / Twitter', icon: '/assets/icons/3d/x.png', hosts: ['x.com', 'twitter.com', 't.co'] },
  { name: 'facebook', label: 'Facebook', icon: '/assets/icons/3d/facebook.png', hosts: ['facebook.com', 'fb.watch', 'fb.com'] },
  { name: 'vimeo', label: 'Vimeo', icon: '/assets/icons/3d/vimeo.png', hosts: ['vimeo.com'] },
  { name: 'snapchat', label: 'Snapchat', icon: '/assets/icons/3d/snapchat.png', hosts: ['snapchat.com'] },
  { name: 'pinterest', label: 'Pinterest', icon: '/assets/icons/3d/pinterest.png', hosts: ['pinterest.com', 'pin.it'] },
  { name: 'reddit', label: 'Reddit', icon: '/assets/icons/3d/reddit.png', hosts: ['reddit.com', 'redd.it'] },
  { name: 'linkedin', label: 'LinkedIn', icon: '/assets/icons/3d/linkedin.png', hosts: ['linkedin.com', 'lnkd.in'] },
];

const byName = new Map(PLATFORMS.map((p) => [p.name, p]));

/** Subdomain-aware hostname match. Returns the platform or null. */
export function platformForHost(hostname: string): Platform | null {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  for (const p of PLATFORMS) {
    for (const h of p.hosts) {
      if (host === h || host.endsWith(`.${h}`)) return p;
    }
  }
  return null;
}

export const platformByName = (name: string): Platform | undefined => byName.get(name);
