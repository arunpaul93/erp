import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/contexts/AuthContext";
import { OrgProvider } from "@/contexts/OrgContext";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Minnal",
  description: "Minnal - Lightning fast ERP with Supabase authentication",
  icons: {
    icon: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-gray-950 text-gray-100 overflow-x-hidden`}
        suppressHydrationWarning
      >
        {/* Clean up any extension-injected attributes early on client */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(()=>{try{var b=document.body;if(!b)return;['bis_register'].forEach(a=>b.removeAttribute(a));for(const attr of Array.from(b.attributes)){if(/^__processed_/.test(attr.name)){b.removeAttribute(attr.name)}}}catch(e){}})();`
          }}
        />
        <AuthProvider>
          <OrgProvider>
            {children}
          </OrgProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
