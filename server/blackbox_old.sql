create table players (
    id integer primary key autoincrement,
    display_name text,
    secret_key text not null unique,
    time_created real not null
);

create table gamesessions (
    id integer primary key autoincrement,
    invite_code text not null unique,
    time_created real not null
);

create table gamesessionplayers (
    gamesession_id integer not null,
    player_id integer not null,
    seat boolean not null check (seat in (0,1)),

    constraint unique_gamesession_seat
        unique(gamesession_id, seat) on conflict abort,
    constraint unique_player_seat
        unique(player_id, seat) on conflict abort,
    constraint fk_gamesessions
        foreign key (gamesession_id)
        references gamesessions(id),
    constraint fk_players
        foreign key (player_id)
        references players(id)
);
