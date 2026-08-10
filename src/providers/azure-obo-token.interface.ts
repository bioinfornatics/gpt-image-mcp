export const OBO_TOKEN_PROVIDER = Symbol('OboAzureTokenProvider');

export interface OboAzureTokenProvider {
  acquireAzureOpenAIToken(): Promise<string>;
}
