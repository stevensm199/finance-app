export interface TransactionExtractor {
  extract(message: string): Promise<unknown>;
}
