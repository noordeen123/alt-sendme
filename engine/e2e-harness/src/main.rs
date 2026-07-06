//! Native interop peer for the e2e suite (`e2e/specs/interop.spec.ts`).
//!
//! Runs the same engine API the Tauri commands wrap, so a passing test here
//! means real desktop<->web protocol compatibility, not a simulation of it.
//!
//! ```text
//! e2e-interop send <file> [relay|id]    share a file; prints TICKET=/HASH=/SIZE=
//! e2e-interop recv <ticket> <outdir>    download a ticket; prints DONE=
//! ```
//!
//! `send` keeps the share open until SIGINT or stdin EOF. The EOF path means
//! a test runner that dies without signalling still tears the share down:
//! the child inherits a pipe, the pipe closes, we exit.

use engine::{download, start_share_items, AddrInfoOptions, ReceiveOptions, SendOptions};
use std::io::Write;
use std::path::PathBuf;

fn usage() -> ! {
    eprintln!("usage: e2e-interop send <file> [relay|id] | e2e-interop recv <ticket> <outdir>");
    std::process::exit(2)
}

#[tokio::main(flavor = "multi_thread")]
async fn main() {
    let args: Vec<String> = std::env::args().collect();

    match args.get(1).map(String::as_str) {
        Some("send") => {
            let path = PathBuf::from(args.get(2).unwrap_or_else(|| usage()));
            let ticket_type = match args.get(3).map(String::as_str) {
                Some("id") => AddrInfoOptions::Id,
                Some("relay") | None => AddrInfoOptions::Relay,
                Some(other) => {
                    eprintln!("unknown ticket type {other:?} (want relay|id)");
                    std::process::exit(2)
                }
            };

            let options = SendOptions {
                ticket_type,
                ..Default::default()
            };
            let share = start_share_items(vec![path], options, &None, None)
                .await
                .expect("start_share_items");

            println!("TICKET={}", share.ticket);
            println!("HASH={}", share.hash);
            println!("SIZE={}", share.size);
            std::io::stdout().flush().ok();

            // Drain stdin into a fixed buffer purely to detect EOF — bounded
            // even if a runner writes data instead of just closing the pipe.
            let stdin_eof = async {
                let mut stdin = tokio::io::stdin();
                let mut buf = [0u8; 1024];
                loop {
                    match tokio::io::AsyncReadExt::read(&mut stdin, &mut buf).await {
                        Ok(0) | Err(_) => break,
                        Ok(_) => {}
                    }
                }
            };
            tokio::select! {
                _ = tokio::signal::ctrl_c() => {}
                _ = stdin_eof => {}
            }
            drop(share);
        }
        Some("recv") => {
            let ticket = args.get(2).unwrap_or_else(|| usage()).clone();
            let outdir = PathBuf::from(args.get(3).unwrap_or_else(|| usage()));
            std::fs::create_dir_all(&outdir).expect("create outdir");

            let options = ReceiveOptions {
                output_dir: Some(outdir),
                ..Default::default()
            };
            let result = download(ticket, options, None).await.expect("download");
            println!("DONE={}", result.message);
        }
        _ => usage(),
    }
}
