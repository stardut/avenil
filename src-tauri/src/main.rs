fn main() {
    let args = std::env::args().skip(1).collect::<Vec<_>>();
    if avenil_lib::cli::is_cli_invocation(&args) {
        avenil_lib::cli::run(args);
    } else {
        avenil_lib::run();
    }
}
