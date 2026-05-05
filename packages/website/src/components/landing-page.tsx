// TODO: Ottie 官网内容待写
import * as React from "react";

interface LandingPageProps {
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  [key: string]: unknown;
}

export function LandingPage(_props: LandingPageProps): React.ReactElement {
  return <div style={{ padding: 32 }}>TODO: Ottie</div>;
}
